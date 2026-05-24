import * as assert from 'assert';
import { resolveUsageStatsTarget, extractAnthropicUsageFromStreamEvent } from '../extension.js';
import getScript, { getSessionTokenTotals } from '../script.js';

suite('Usage panel routing', () => {
	test('routes usage button to local stats modal', () => {
		assert.strictEqual(resolveUsageStatsTarget('api'), 'local-modal');
		assert.strictEqual(resolveUsageStatsTarget('plan'), 'local-modal');
	});
});

suite('Usage stats script', () => {
	test('renders session tokens from anthropic aggregate totals', () => {
		const script = getScript(false);
		assert.ok(script.includes('const sessionInputTokens = (anthropicTotalInputTokens + anthropicTotalOutputTokens) > 0 ? anthropicTotalInputTokens : totalTokensInput;'));
		assert.ok(script.includes('const sessionOutputTokens = (anthropicTotalInputTokens + anthropicTotalOutputTokens) > 0 ? anthropicTotalOutputTokens : totalTokensOutput;'));
		assert.ok(script.includes('formatTokenCount(sessionInputTokens)'));
		assert.ok(script.includes('formatTokenCount(sessionOutputTokens)'));
	});
});

suite('Session token totals', () => {
	test('prefers local Anthropic aggregate totals over direct session totals', () => {
		const totals = getSessionTokenTotals({
			totalTokensInput: 0,
			totalTokensOutput: 0,
			anthropicTotalInputTokens: 123,
			anthropicTotalOutputTokens: 456,
		});
		assert.strictEqual(totals.input, 123);
		assert.strictEqual(totals.output, 456);
	});

	test('falls back to direct session totals when anthropic aggregates are empty', () => {
		const totals = getSessionTokenTotals({
			totalTokensInput: 10,
			totalTokensOutput: 20,
			anthropicTotalInputTokens: 0,
			anthropicTotalOutputTokens: 0,
		});
		assert.strictEqual(totals.input, 10);
		assert.strictEqual(totals.output, 20);
	});
});

suite('Anthropic usage extraction', () => {
	test('extracts usage from message_delta usage when message usage is absent', () => {
		const usage = extractAnthropicUsageFromStreamEvent({
			type: 'message_delta',
			usage: {
				input_tokens: 111,
				output_tokens: 222,
				cache_read_input_tokens: 333,
				cache_creation_input_tokens: 444,
			},
		});
		assert.deepStrictEqual(usage, {
			input_tokens: 111,
			output_tokens: 222,
			cache_read_input_tokens: 333,
			cache_creation_input_tokens: 444,
		});
	});

	test('message_delta usage increments local totals', () => {
		const script = getScript(false);
		assert.ok(script.includes("case 'message_delta':"));
		assert.ok(script.includes('const deltaUsage = extractAnthropicUsageFromStreamEvent(jsonData);'));
		assert.ok(script.includes('this._totalTokensInput += deltaUsage.input_tokens || 0;'));
		assert.ok(script.includes('this._totalTokensOutput += deltaUsage.output_tokens || 0;'));
	});
});

suite('Router Anthropic usage stats', () => {
	test('always uses local usage stats view', async () => {
		const extension = await import('../extension.js');
		assert.strictEqual(typeof (extension as any).shouldOpenLocalUsageStats, 'function');
		assert.strictEqual((extension as any).shouldOpenLocalUsageStats('api'), true);
		assert.strictEqual((extension as any).shouldOpenLocalUsageStats('plan'), true);
	});

	test('accumulates token totals and computes cache hit rate', async () => {
		const router = await import('../router/index.js');
		const resetStats = (router as any).__testResetAnthropicUsageStats;
		const recordUsage = (router as any).__testRecordAnthropicUsage;
		const getStats = (router as any).__testGetAnthropicUsageStats;

		assert.strictEqual(typeof resetStats, 'function');
		assert.strictEqual(typeof recordUsage, 'function');
		assert.strictEqual(typeof getStats, 'function');

		resetStats();
		recordUsage({
			input_tokens: 100,
			output_tokens: 40,
			cache_read_input_tokens: 300,
			cache_creation_input_tokens: 20,
		});
		recordUsage({
			input_tokens: 100,
			output_tokens: 60,
			cache_read_input_tokens: 100,
			cache_creation_input_tokens: 10,
		});

		const stats = getStats();
		assert.strictEqual(stats.totalInputTokens, 200);
		assert.strictEqual(stats.totalOutputTokens, 100);
		assert.strictEqual(stats.totalCacheReadInputTokens, 400);
		assert.strictEqual(stats.totalCacheCreationInputTokens, 30);
		assert.strictEqual(stats.cacheHitRate, 400 / 600);
	});

		test('keeps cache hit rate at zero when no input tokens were recorded', async () => {
		const router = await import('../router/index.js');
		const resetStats = (router as any).__testResetAnthropicUsageStats;
		const getStats = (router as any).__testGetAnthropicUsageStats;
		resetStats();
		const stats = getStats();
		assert.strictEqual(stats.totalInputTokens, 0);
		assert.strictEqual(stats.totalOutputTokens, 0);
		assert.strictEqual(stats.totalCacheReadInputTokens, 0);
		assert.strictEqual(stats.totalCacheCreationInputTokens, 0);
		assert.strictEqual(stats.cacheHitRate, 0);
	});
});

suite('Tool result correlation', () => {
	test('matches tool results to the tool use id instead of the last tool use', async () => {
		const extension = await import('../extension.js');
		const resolveToolUse = (extension as any).__testResolveToolUseForResult;
		assert.strictEqual(typeof resolveToolUse, 'function');

		const conversation = [
			{ messageType: 'toolUse', data: { toolUseId: 'tool-1', toolName: 'Edit', rawInput: { file_path: 'a.ts' } } },
			{ messageType: 'toolUse', data: { toolUseId: 'tool-2', toolName: 'Write', rawInput: { file_path: 'b.ts' } } },
		];

		const matched = resolveToolUse(conversation, 'tool-1');
		assert.strictEqual(matched?.data?.toolUseId, 'tool-1');
		assert.strictEqual(matched?.data?.rawInput?.file_path, 'a.ts');
	});

	test('uses unique pending change keys for repeated edits on the same file', async () => {
		const extension = await import('../extension.js');
		const createPendingKey = (extension as any).__testCreatePendingLatestChangeKey;
		assert.strictEqual(typeof createPendingKey, 'function');

		const firstKey = createPendingKey('session-1', 'a.ts', 'tool-1');
		const secondKey = createPendingKey('session-1', 'a.ts', 'tool-2');
		assert.notStrictEqual(firstKey, secondKey);
	});
});

suite('OpenAI bridge reasoning cache path defaults', () => {
	test('defaults to the workspace .claude directory when unset', async () => {
		const configModule = await import('../openai-bridge/config.js');
		const resolveReasoningCachePath = (configModule as any).__testResolveReasoningCachePath;
		assert.strictEqual(typeof resolveReasoningCachePath, 'function');
		const resolved = resolveReasoningCachePath('', 'c:/workspace/project', 'c:/configs/bridge', 'c:/Users/test/.claude/fallback.json');
		assert.ok(resolved.endsWith('.claude\\reasoning-cache.json') || resolved.endsWith('.claude/reasoning-cache.json'));
		assert.ok(resolved.includes('workspace'));
		assert.ok(resolved.includes('project'));
	});

	test('falls back to the home cache file when no workspace exists', async () => {
		const configModule = await import('../openai-bridge/config.js');
		const resolveReasoningCachePath = (configModule as any).__testResolveReasoningCachePath;
		assert.strictEqual(typeof resolveReasoningCachePath, 'function');
		assert.strictEqual(
			resolveReasoningCachePath('', '', 'c:/configs/bridge', 'c:/Users/test/.claude/fallback.json'),
			'c:/Users/test/.claude/fallback.json'
		);
	});
});

suite('Latest changes merge history', () => {
	function makeLatestChange(overrides: Record<string, unknown> = {}) {
		return {
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
			...overrides,
		};
	}

	test('merges repeated same-file latest changes into one top-level item with history', async () => {
		const extension = await import('../extension.js');
		const mergeLatestChange = (extension as any).__testMergeLatestChangeItem;
		assert.strictEqual(typeof mergeLatestChange, 'function');

		const first = makeLatestChange();
		const second = makeLatestChange({
			changeKey: 'session::a.ts::tool-2',
			toolName: 'Write',
			oldContent: 'b',
			newContent: 'c',
			timeLabel: '10:01',
			updatedAt: 2,
		});

		const merged = mergeLatestChange([], first);
		const updated = mergeLatestChange(merged, second);
		assert.strictEqual(updated.length, 1);
		assert.strictEqual(updated[0].newContent, 'c');
		assert.strictEqual(updated[0].oldContent, 'a');
		assert.strictEqual(updated[0].history.length, 2);
	});

	test('merges watcher-style updates by file path instead of adding duplicate rows', async () => {
		const extension = await import('../extension.js');
		const mergeLatestChange = (extension as any).__testMergeLatestChangeItem;
		assert.strictEqual(typeof mergeLatestChange, 'function');

		const first = makeLatestChange({ changeKey: 'session::a.ts::tool-1', updatedAt: 1 });
		const watcher = makeLatestChange({ changeKey: 'session::a.ts::watcher', newContent: 'final', updatedAt: 2, toolName: 'Write' });
		const merged = mergeLatestChange(mergeLatestChange([], first), watcher);
		assert.strictEqual(merged.length, 1);
		assert.strictEqual(merged[0].history.length, 2);
		assert.strictEqual(merged[0].newContent, 'final');
	});

	test('latest changes script renders history toggle for merged file entries', () => {
		const script = getScript(false);
		assert.ok(script.includes('latest-change-history'));
		assert.ok(script.includes('toggleLatestChangeHistory'));
		assert.ok(script.includes('history.length'));
	});

	test('history diff actions do not change top-level accept reject semantics', () => {
		const script = getScript(false);
		assert.ok(script.includes('data-history-index'));
		assert.ok(script.includes('openLatestChangeHistoryDiff'));
		assert.ok(script.includes('acceptLatestChangeByKey(changeKey)'));
		assert.ok(script.includes('rejectLatestChangeByKey(changeKey)'));
	});
});
