# Latest Changes Same-File Merge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge repeated same-file edits into one top-level latest-changes item while keeping expandable per-file history and leaving the chat transcript unchanged.

**Architecture:** Extend the backend latest-change item shape to keep both final file state and a per-file history array. Keep chat tool events unchanged, merge top-level latest-changes entries by file path in backend capture paths, and render expandable history rows in the webview without changing Accept/Reject semantics.

**Tech Stack:** TypeScript, VS Code extension API, webview script rendering, existing Mocha-based extension tests

---

### Task 1: Extend latest-changes data model

**Files:**
- Modify: `src/extension.ts:163-189`
- Test: `src/test/extension.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
test('merges repeated same-file latest changes into one top-level item with history', async () => {
  const extension = await import('../extension.js');
  const merge = (extension as any).__testMergeLatestChangeEntry;
  const first = {
    changeKey: 'session::a.ts::tool-1',
    sessionId: 'session',
    filePath: 'a.ts',
    absolutePath: 'a.ts',
    status: 'modified',
    fileName: 'a.ts',
    directoryLabel: '',
    timeLabel: '10:00',
    isReverted: false,
    toolName: 'Edit',
    oldContent: 'a',
    newContent: 'b',
    beforeExists: true,
    updatedAt: 1,
  };
  const second = {
    ...first,
    changeKey: 'session::a.ts::tool-2',
    toolName: 'Write',
    oldContent: 'b',
    newContent: 'c',
    timeLabel: '10:01',
    updatedAt: 2,
  };
  const merged = merge([], first);
  const updated = merge(merged, second);
  assert.strictEqual(updated.length, 1);
  assert.strictEqual(updated[0].newContent, 'c');
  assert.strictEqual(updated[0].history.length, 2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node_modules/.bin/vscode-test --grep "merges repeated same-file latest changes into one top-level item with history"`
Expected: FAIL because `__testMergeLatestChangeEntry` does not exist.

- [ ] **Step 3: Write minimal implementation**

Add a `LatestChangeHistoryEntry` interface and extend `LatestChangeItem` with `history: LatestChangeHistoryEntry[]`. Add a small helper that inserts a first item or appends history + updates final state when the same session/file already exists.

- [ ] **Step 4: Run test to verify it passes**

Run: `node_modules/.bin/vscode-test --grep "merges repeated same-file latest changes into one top-level item with history"`
Expected: PASS

### Task 2: Apply merge logic to tool-captured file changes

**Files:**
- Modify: `src/extension.ts:2316-2436`
- Test: `src/test/extension.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
test('keeps original baseline when same file is changed multiple times', async () => {
  const extension = await import('../extension.js');
  const merge = (extension as any).__testMergeLatestChangeEntry;
  const first = makeLatestChange({ oldContent: 'one', newContent: 'two', updatedAt: 1 });
  const second = makeLatestChange({ oldContent: 'two', newContent: 'three', updatedAt: 2, changeKey: 'session::a.ts::tool-2' });
  const result = merge(merge([], first), second);
  assert.strictEqual(result[0].oldContent, 'one');
  assert.strictEqual(result[0].newContent, 'three');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node_modules/.bin/vscode-test --grep "keeps original baseline when same file is changed multiple times"`
Expected: FAIL because merged items currently overwrite top-level baseline behavior.

- [ ] **Step 3: Write minimal implementation**

In the tool-result path, replace direct `findIndex(changeKey)` replacement with merge-by-file-path logic so top-level `oldContent` stays at the file baseline and `newContent` tracks the latest final state.

- [ ] **Step 4: Run test to verify it passes**

Run: `node_modules/.bin/vscode-test --grep "keeps original baseline when same file is changed multiple times"`
Expected: PASS

### Task 3: Apply merge logic to watcher finalization path

**Files:**
- Modify: `src/extension.ts:5481-5544`
- Test: `src/test/extension.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
test('merges watcher-style updates by file path instead of adding duplicate rows', async () => {
  const extension = await import('../extension.js');
  const merge = (extension as any).__testMergeLatestChangeEntry;
  const items = merge([], makeLatestChange({ changeKey: 's::a.ts::tool-1', updatedAt: 1 }));
  const merged = merge(items, makeLatestChange({ changeKey: 's::a.ts::watcher', updatedAt: 2, newContent: 'final' }));
  assert.strictEqual(merged.length, 1);
  assert.strictEqual(merged[0].history.length, 2);
  assert.strictEqual(merged[0].newContent, 'final');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node_modules/.bin/vscode-test --grep "merges watcher-style updates by file path instead of adding duplicate rows"`
Expected: FAIL because watcher finalization still uses raw `session + filePath` replacement logic.

- [ ] **Step 3: Write minimal implementation**

Refactor watcher finalization so it creates the same entry shape and feeds it through the shared merge helper, keeping both capture paths consistent.

- [ ] **Step 4: Run test to verify it passes**

Run: `node_modules/.bin/vscode-test --grep "merges watcher-style updates by file path instead of adding duplicate rows"`
Expected: PASS

### Task 4: Render expandable history in latest-changes UI

**Files:**
- Modify: `src/script.ts:1308-1358`
- Test: `src/test/extension.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
test('latest changes script renders history toggle for merged file entries', () => {
  const script = getScript(false);
  assert.ok(script.includes('latest-change-history'));
  assert.ok(script.includes('toggleLatestChangeHistory'));
  assert.ok(script.includes('history.length'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node_modules/.bin/vscode-test --grep "latest changes script renders history toggle for merged file entries"`
Expected: FAIL because current script has no history toggle rendering.

- [ ] **Step 3: Write minimal implementation**

Add collapsed summary rendering with change count, an expand/collapse toggle, and a per-item history section that lists tool name, time label, and an `Open Diff` action for each history entry.

- [ ] **Step 4: Run test to verify it passes**

Run: `node_modules/.bin/vscode-test --grep "latest changes script renders history toggle for merged file entries"`
Expected: PASS

### Task 5: Preserve final-state Accept/Reject behavior

**Files:**
- Modify: `src/script.ts:1342-1358`
- Modify: `src/extension.ts:5605-5756`
- Test: `src/test/extension.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
test('history diff actions do not change top-level accept reject semantics', () => {
  const script = getScript(false);
  assert.ok(script.includes('data-history-index'));
  assert.ok(script.includes('openLatestChangeHistoryDiff'));
  assert.ok(script.includes('acceptLatestChangeByKey(changeKey)'));
  assert.ok(script.includes('rejectLatestChangeByKey(changeKey)'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node_modules/.bin/vscode-test --grep "history diff actions do not change top-level accept reject semantics"`
Expected: FAIL because history diff actions do not exist yet.

- [ ] **Step 3: Write minimal implementation**

Keep top-level accept/reject actions unchanged. Add a separate history-diff action that opens the selected history entry diff without introducing per-entry accept/reject.

- [ ] **Step 4: Run test to verify it passes**

Run: `node_modules/.bin/vscode-test --grep "history diff actions do not change top-level accept reject semantics"`
Expected: PASS

### Task 6: Run focused verification

**Files:**
- Modify: `src/test/extension.test.ts`
- Verify: `src/extension.ts`, `src/script.ts`

- [ ] **Step 1: Run focused regression tests**

Run: `node_modules/.bin/vscode-test --grep "Tool result correlation|OpenAI bridge reasoning cache path defaults|latest changes|same file|history"`
Expected: PASS with all targeted tests green.

- [ ] **Step 2: Run compile**

Run: `npm run compile`
Expected: compile succeeds and updates `out/`.

- [ ] **Step 3: Review diff for scope**

Run: `git diff -- src/extension.ts src/script.ts src/test/extension.test.ts`
Expected: only latest-changes merge/history changes appear.
