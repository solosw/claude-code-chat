import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import {
  SessionInfo,
  Snapshot,
  FileBackup,
  findSessionsForWorkspace,
  getCumulativeChanges,
  readBackupFile,
  findNextBackup,
} from "./checkpointService";

export class CheckpointWebviewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "claudeChanges";
  private _view?: vscode.WebviewView;
  private _revertedFiles = new Set<string>();

  constructor(
    private workspacePath: string | undefined,
    private log?: (msg: string) => void
  ) {}

  refresh(): void {
    if (this._revertedFiles.size > 500) {
      this._revertedFiles.clear();
    }
    if (this._view) {
      this._updateContent(this._view.webview);
    }
  }

  markFileReverted(sessionId: string, absolutePath: string): void {
    this._revertedFiles.add(this._revertedKey(sessionId, absolutePath));
    this._view?.webview.postMessage({
      command: "markReverted",
      sessionId,
      absolutePath,
    });
  }

  markAllReverted(sessionId: string, absolutePaths: string[]): void {
    for (const p of absolutePaths) {
      this._revertedFiles.add(this._revertedKey(sessionId, p));
    }
    this._view?.webview.postMessage({
      command: "markAllReverted",
      sessionId,
      absolutePaths,
    });
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
    };

    webviewView.webview.onDidReceiveMessage((message) => {
      switch (message.command) {
        case "viewDiff":
          vscode.commands.executeCommand(
            "claudeChanges.viewDiffData",
            message.sessionId,
            message.filePath,
            message.absolutePath,
            message.backupFileName,
            message.version,
            message.backupTime,
            message.mode,
            message.nextBackupFileName
          );
          break;
        case "restoreFile":
          vscode.commands.executeCommand(
            "claudeChanges.restoreFileData",
            message.sessionId,
            message.absolutePath,
            message.backupFileName,
            message.version
          );
          break;
        case "revertAll":
          vscode.commands.executeCommand(
            "claudeChanges.revertAllData",
            message.sessionId
          );
          break;
        case "deleteFile":
          vscode.commands.executeCommand(
            "claudeChanges.deleteFileData",
            message.absolutePath,
            message.sessionId
          );
          break;
      }
    });

    this._updateContent(webviewView.webview);
  }

  private async _updateContent(webview: vscode.Webview): Promise<void> {
    if (!this.workspacePath) {
      webview.html = this._getEmptyHtml("No workspace folder open");
      return;
    }

    const sessions = await findSessionsForWorkspace(this.workspacePath, this.log);

    if (sessions.length === 0) {
      webview.html = this._getEmptyHtml("No Claude checkpoints found for this workspace");
      return;
    }

    webview.html = this._getHtml(sessions);
  }

  private _getEmptyHtml(message: string): string {
    return `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 16px; display: flex; align-items: center; justify-content: center; min-height: 200px; }
  .empty { text-align: center; opacity: 0.6; font-size: 12px; }
  .empty-icon { font-size: 32px; margin-bottom: 8px; }
</style></head>
<body><div class="empty"><div class="empty-icon">&#x1f50d;</div>${message}</div></body></html>`;
  }

  private _getHtml(sessions: SessionInfo[]): string {
    const sessionsHtml = sessions.map((s, si) => this._renderSession(s, si)).join("");

    return `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: transparent;
    padding: 0 5px 10px 5px;
    line-height: 1.4;
  }

  /* ── Toolbar ── */
  .toolbar {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 2px;
    padding: 6px 4px;
    position: sticky;
    top: 0;
    z-index: 10;
    background: var(--vscode-sideBar-background);
  }

  .toolbar-btn {
    background: none;
    border: none;
    color: var(--vscode-foreground);
    cursor: pointer;
    padding: 3px 6px;
    border-radius: 4px;
    font-size: 11px;
    opacity: 0.6;
    transition: opacity 0.1s, background 0.1s;
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .toolbar-btn:hover {
    opacity: 1;
    background: var(--vscode-toolbar-hoverBackground);
  }
  .toolbar-btn svg { width: 14px; height: 14px; }

  /* ── Session Card ── */
  .session {
    margin-bottom: 14px;
    border-radius: 8px;
    background: var(--vscode-sideBar-background);
    border: 1px solid var(--vscode-panel-border, transparent);
    overflow: hidden;
  }

  .session-header {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 11px 12px 10px 12px;
    cursor: pointer;
    user-select: none;
    transition: background 0.15s;
  }
  .session-header:hover {
    background: var(--vscode-list-hoverBackground);
  }

  .session-chevron {
    flex-shrink: 0;
    width: 16px;
    height: 16px;
    margin-top: 2px;
    transition: transform 0.2s ease;
    opacity: 0.7;
  }
  .session.collapsed .session-chevron {
    transform: rotate(-90deg);
  }

  .session-info { flex: 1; min-width: 0; }

  .session-title {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12.5px;
    font-weight: 650;
    color: var(--vscode-foreground);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .session-dot {
    flex-shrink: 0;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--vscode-gitDecoration-addedResourceForeground, #73c991);
  }

  .relative-time {
    font-weight: 600;
    color: var(--vscode-textLink-foreground);
  }

  .session-meta {
    display: flex;
    align-items: center;
    gap: 7px;
    margin-top: 4px;
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
    flex-wrap: wrap;
  }

  .badge {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 2px 7px;
    border-radius: 999px;
    font-size: 10.5px;
    font-weight: 500;
    background: color-mix(in srgb, var(--vscode-foreground) 10%, transparent);
    color: color-mix(in srgb, var(--vscode-descriptionForeground) 92%, var(--vscode-foreground) 8%);
  }
  .badge.files {
    background: color-mix(in srgb, var(--vscode-gitDecoration-addedResourceForeground, #73c991) 16%, transparent);
    color: var(--vscode-gitDecoration-addedResourceForeground, #73c991);
  }

  .session-body {
    max-height: 5000px;
    overflow: hidden;
    transition: max-height 0.3s ease, opacity 0.2s ease;
    opacity: 1;
    background: color-mix(in srgb, var(--vscode-foreground) 4%, transparent);
  }
  .session.collapsed .session-body {
    max-height: 0;
    opacity: 0;
  }

  /* ── Section Label ── */
  .section-label {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--vscode-descriptionForeground);
    padding: 8px 12px 4px 12px;
  }

  /* ── Cumulative Files ── */
  .cumulative-files {
    padding: 0 6px 6px 6px;
  }

  /* ── Timeline Toggle ── */
  .timeline-toggle {
    margin: 6px 6px 7px 6px;
  }

  .timeline-toggle-header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 9px;
    cursor: pointer;
    user-select: none;
    border-radius: 6px;
    font-size: 11.5px;
    font-weight: 550;
    color: color-mix(in srgb, var(--vscode-descriptionForeground) 88%, var(--vscode-foreground) 12%);
    transition: background 0.1s;
  }
  .timeline-toggle-header:hover {
    background: var(--vscode-list-hoverBackground);
  }

  .timeline-toggle-chevron {
    width: 12px;
    height: 12px;
    transition: transform 0.2s ease;
    opacity: 0.6;
  }
  .timeline-toggle.collapsed .timeline-toggle-chevron {
    transform: rotate(-90deg);
  }

  .timeline-toggle-body {
    max-height: 5000px;
    overflow: hidden;
    transition: max-height 0.3s ease, opacity 0.2s ease;
    opacity: 1;
  }
  .timeline-toggle.collapsed .timeline-toggle-body {
    max-height: 0;
    opacity: 0;
  }

  /* ── Timeline ── */
  .timeline {
    padding: 10px 12px 12px 12px;
    margin: 0 6px 6px 6px;
    position: relative;
    background: color-mix(in srgb, var(--vscode-foreground) 5%, transparent);
    border-radius: 7px;
    border: 1px solid color-mix(in srgb, var(--vscode-foreground) 7%, transparent);
  }

  .checkpoint {
    position: relative;
    padding-left: 24px;
    padding-bottom: 8px;
  }
  .checkpoint:last-child { padding-bottom: 0; }

  /* Vertical line */
  .checkpoint::before {
    content: '';
    position: absolute;
    left: 6px;
    top: 18px;
    bottom: -3px;
    width: 1px;
    background: var(--vscode-gitDecoration-addedResourceForeground, #73c991);
    opacity: 0.25;
  }
  .checkpoint:last-child::before { display: none; }

  /* Dot */
  .checkpoint::after {
    content: '';
    position: absolute;
    left: 2px;
    top: 8px;
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: var(--vscode-gitDecoration-addedResourceForeground, #73c991);
    z-index: 1;
  }

  .checkpoint-header {
    display: flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
    user-select: none;
    padding: 5px 8px;
    margin-left: -8px;
    border-radius: 6px;
    transition: background 0.1s;
  }
  .checkpoint-header:hover {
    background: var(--vscode-list-hoverBackground);
  }

  .checkpoint-time {
    font-size: 11.5px;
    font-weight: 650;
    color: var(--vscode-foreground);
    transition: color 0.15s;
  }
  .checkpoint-header:hover .checkpoint-time {
    color: var(--vscode-textLink-foreground);
  }

  .checkpoint-count {
    font-size: 10px;
    padding: 1px 6px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--vscode-gitDecoration-addedResourceForeground, #73c991) 16%, transparent);
    color: var(--vscode-gitDecoration-addedResourceForeground, #73c991);
  }

  .checkpoint-chevron {
    width: 12px;
    height: 12px;
    transition: transform 0.2s ease;
    opacity: 0.5;
  }
  .checkpoint.collapsed .checkpoint-chevron {
    transform: rotate(-90deg);
  }

  .checkpoint-files {
    max-height: 500px;
    overflow: hidden;
    transition: max-height 0.25s ease, opacity 0.15s ease;
    opacity: 1;
    margin-top: 3px;
    margin-left: 3px;
    padding-left: 8px;
    border-left: 1px solid color-mix(in srgb, var(--vscode-foreground) 12%, transparent);
  }
  .checkpoint.collapsed .checkpoint-files {
    max-height: 0;
    opacity: 0;
  }

  /* ── File Items ── */
  .file-item {
    display: grid;
    grid-template-columns: 18px minmax(0, 1fr) auto;
    align-items: start;
    gap: 8px;
    padding: 6px 8px;
    border-radius: 6px;
    cursor: pointer;
    transition: background 0.1s;
    font-size: 12px;
    margin-bottom: 1px;
  }
  .file-item:hover {
    background: var(--vscode-list-hoverBackground);
  }

  .file-item.reverted {
    opacity: 0.45;
    pointer-events: none;
  }
  .file-item.reverted .file-name {
    text-decoration: line-through;
  }
  .file-item.reverted .file-actions {
    display: none;
  }
  .reverted-badge {
    font-size: 9px;
    padding: 0 5px;
    border-radius: 8px;
    background: color-mix(in srgb, var(--vscode-gitDecoration-addedResourceForeground, #73c991) 20%, transparent);
    color: var(--vscode-gitDecoration-addedResourceForeground, #73c991);
    font-weight: 600;
  }

  .file-icon {
    width: 18px;
    height: 18px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 10px;
    font-weight: 700;
    border-radius: 3px;
    margin-top: 1px;
  }

  .file-main {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .file-icon.added {
    color: var(--vscode-gitDecoration-addedResourceForeground, #73c991);
  }
  .file-icon.modified {
    color: var(--vscode-gitDecoration-modifiedResourceForeground, #e2c08d);
  }
  .file-icon.deleted {
    color: var(--vscode-gitDecoration-deletedResourceForeground, #f14c4c);
  }

  .file-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--vscode-foreground);
    font-weight: 500;
    line-height: 1.25;
  }
  .file-path {
    display: block;
    font-size: 10px;
    color: color-mix(in srgb, var(--vscode-descriptionForeground) 90%, var(--vscode-foreground) 10%);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 100%;
    line-height: 1.2;
  }

  .file-side {
    display: flex;
    align-items: center;
    gap: 6px;
    justify-self: end;
    min-width: 0;
  }

  .file-actions {
    display: flex;
    gap: 3px;
    flex-shrink: 0;
    align-self: center;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.12s ease;
  }
  .file-item:hover .file-actions,
  .file-item:focus-within .file-actions {
    opacity: 0.95;
    pointer-events: auto;
  }

  .action-btn {
    background: none;
    border: none;
    color: var(--vscode-foreground);
    cursor: pointer;
    padding: 2px 4px;
    border-radius: 3px;
    font-size: 12px;
    opacity: 0.7;
    transition: opacity 0.1s, background 0.1s;
  }
  .action-btn:hover {
    opacity: 1;
    background: var(--vscode-toolbar-hoverBackground);
  }

  /* ── Revert All Button ── */
  .revert-all-btn {
    margin-left: auto;
    background: none;
    border: 1px solid color-mix(in srgb, var(--vscode-foreground) 20%, transparent);
    color: var(--vscode-foreground);
    cursor: pointer;
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 10px;
    font-family: var(--vscode-font-family);
    opacity: 0.7;
    transition: opacity 0.1s, background 0.1s;
  }
  .revert-all-btn:hover {
    opacity: 1;
    background: var(--vscode-toolbar-hoverBackground);
  }

  /* ── Scrollbar ── */
  ::-webkit-scrollbar { width: 6px; }
  ::-webkit-scrollbar-thumb { background: var(--vscode-scrollbarSlider-background); border-radius: 3px; }
  ::-webkit-scrollbar-thumb:hover { background: var(--vscode-scrollbarSlider-hoverBackground); }
</style>
</head>
<body>
  <div class="toolbar">
    <button class="toolbar-btn" id="expandAll" title="Expand All">
      <svg viewBox="0 0 16 16" fill="currentColor"><path d="M9 9H4v1h5V9zm0-4H4v1h5V5zm3-3H1v11h11V2zm-1 10H2V3h9v9zm2-12v1h1v11H4v-1H3v2h12V0h-2z"/></svg>
      <span>Expand</span>
    </button>
    <button class="toolbar-btn" id="collapseAll" title="Collapse All">
      <svg viewBox="0 0 16 16" fill="currentColor"><path d="M14 1H3L2 2v11l1 1h11l1-1V2l-1-1zM8 11H4v-1h4v1zm3-4H4V6h7v1z"/></svg>
      <span>Collapse</span>
    </button>
  </div>
  ${sessionsHtml}
  <script>
    const vscode = acquireVsCodeApi();
    const persistedState = vscode.getState() || {};
    const uiState = {
      sessions: persistedState.sessions || {},
      toggles: persistedState.toggles || {},
      checkpoints: persistedState.checkpoints || {},
    };

    function toggleKey(el) {
      const sessionId = el.dataset.sessionId || '';
      const toggleId = el.dataset.toggleId || '';
      return sessionId && toggleId ? sessionId + '::' + toggleId : '';
    }

    function persistUiState() {
      vscode.setState(uiState);
    }

    function rememberSession(el) {
      const sessionId = el?.dataset?.sessionId;
      if (sessionId) {
        uiState.sessions[sessionId] = el.classList.contains('collapsed');
      }
    }

    function rememberToggle(el) {
      const key = toggleKey(el);
      if (key) {
        uiState.toggles[key] = el.classList.contains('collapsed');
      }
    }

    function rememberCheckpoint(el) {
      const checkpointId = el?.dataset?.checkpointId;
      if (checkpointId) {
        uiState.checkpoints[checkpointId] = el.classList.contains('collapsed');
      }
    }

    function applyUiState() {
      document.querySelectorAll('.session').forEach(el => {
        const sessionId = el.dataset.sessionId;
        if (!sessionId) return;
        const collapsed = uiState.sessions[sessionId];
        if (collapsed === true) el.classList.add('collapsed');
        if (collapsed === false) el.classList.remove('collapsed');
      });

      document.querySelectorAll('.timeline-toggle').forEach(el => {
        const key = toggleKey(el);
        if (!key) return;
        const collapsed = uiState.toggles[key];
        if (collapsed === true) el.classList.add('collapsed');
        if (collapsed === false) el.classList.remove('collapsed');
      });

      document.querySelectorAll('.checkpoint').forEach(el => {
        const checkpointId = el.dataset.checkpointId;
        if (!checkpointId) return;
        const collapsed = uiState.checkpoints[checkpointId];
        if (collapsed === true) el.classList.add('collapsed');
        if (collapsed === false) el.classList.remove('collapsed');
      });
    }

    applyUiState();

    // Session toggle
    document.querySelectorAll('.session-header').forEach(el => {
      el.addEventListener('click', () => {
        const session = el.closest('.session');
        session.classList.toggle('collapsed');
        rememberSession(session);
        persistUiState();
      });
    });

    // Checkpoint toggle
    document.querySelectorAll('.checkpoint-header').forEach(el => {
      el.addEventListener('click', () => {
        const checkpoint = el.closest('.checkpoint');
        checkpoint.classList.toggle('collapsed');
        rememberCheckpoint(checkpoint);
        persistUiState();
      });
    });

    // Timeline toggle
    document.querySelectorAll('.timeline-toggle-header').forEach(el => {
      el.addEventListener('click', () => {
        const toggle = el.closest('.timeline-toggle');
        toggle.classList.toggle('collapsed');
        rememberToggle(toggle);
        persistUiState();
      });
    });

    // Expand all
    document.getElementById('expandAll').addEventListener('click', () => {
      document.querySelectorAll('.session.collapsed').forEach(el => {
        el.classList.remove('collapsed');
        rememberSession(el);
      });
      document.querySelectorAll('.timeline-toggle.collapsed').forEach(el => {
        el.classList.remove('collapsed');
        rememberToggle(el);
      });
      document.querySelectorAll('.checkpoint.collapsed').forEach(el => {
        el.classList.remove('collapsed');
        rememberCheckpoint(el);
      });
      persistUiState();
    });

    // Collapse all
    document.getElementById('collapseAll').addEventListener('click', () => {
      document.querySelectorAll('.session:not(.collapsed)').forEach(el => {
        el.classList.add('collapsed');
        rememberSession(el);
      });
      document.querySelectorAll('.timeline-toggle:not(.collapsed)').forEach(el => {
        el.classList.add('collapsed');
        rememberToggle(el);
      });
      document.querySelectorAll('.checkpoint:not(.collapsed)').forEach(el => {
        el.classList.add('collapsed');
        rememberCheckpoint(el);
      });
      persistUiState();
    });

    // File click -> diff
    document.querySelectorAll('.file-item').forEach(el => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('.action-btn')) return;
        vscode.postMessage({
          command: 'viewDiff',
          sessionId: el.dataset.sessionId,
          filePath: el.dataset.filePath,
          absolutePath: el.dataset.absolutePath,
          backupFileName: el.dataset.backupFileName || null,
          version: parseInt(el.dataset.version),
          backupTime: el.dataset.backupTime,
          mode: el.dataset.mode,
          nextBackupFileName: el.dataset.nextBackupFileName || null
        });
      });
    });

    // Restore button
    document.querySelectorAll('.restore-btn').forEach(el => {
      el.addEventListener('click', () => {
        const fi = el.closest('.file-item');
        vscode.postMessage({
          command: 'restoreFile',
          sessionId: fi.dataset.sessionId,
          absolutePath: fi.dataset.absolutePath,
          backupFileName: fi.dataset.backupFileName || null,
          version: parseInt(fi.dataset.version)
        });
      });
    });

    // Delete button (for created files)
    document.querySelectorAll('.delete-btn').forEach(el => {
      el.addEventListener('click', () => {
        const fi = el.closest('.file-item');
        vscode.postMessage({
          command: 'deleteFile',
          absolutePath: fi.dataset.absolutePath,
          sessionId: fi.dataset.sessionId
        });
      });
    });

    // Revert All button
    document.querySelectorAll('.revert-all-btn').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        vscode.postMessage({
          command: 'revertAll',
          sessionId: el.dataset.sessionId
        });
      });
    });
    // Listen for messages from extension (mark reverted)
    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.command === 'markReverted') {
        document.querySelectorAll('.file-item').forEach(el => {
          const sameSession = el.dataset.sessionId === msg.sessionId;
          const samePath = el.dataset.absolutePath === msg.absolutePath;
          if (sameSession && samePath && !el.classList.contains('reverted')) {
            el.classList.add('reverted');
            const actions = el.querySelector('.file-actions');
            if (actions) {
              actions.insertAdjacentHTML('beforebegin', '<span class="reverted-badge">reverted</span>');
            }
          }
        });
      }
      if (msg.command === 'markAllReverted') {
        const revertedPaths = new Set(msg.absolutePaths || []);
        document.querySelectorAll('.file-item').forEach(el => {
          const sameSession = el.dataset.sessionId === msg.sessionId;
          const samePath = revertedPaths.size === 0 || revertedPaths.has(el.dataset.absolutePath);
          if (sameSession && samePath && !el.classList.contains('reverted')) {
            el.classList.add('reverted');
            const actions = el.querySelector('.file-actions');
            if (actions) {
              actions.insertAdjacentHTML('beforebegin', '<span class="reverted-badge">reverted</span>');
            }
          }
        });
      }
    });
  </script>
</body></html>`;
  }

  private _renderSession(session: SessionInfo, index: number): string {
    const date = session.lastActivity;
    const dateStr = date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
    const timeStr = date.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
    const title = this._escapeHtml(
      session.firstUserMessage || session.slug || session.sessionId.slice(0, 8)
    );
    const fullTitle =
      session.firstUserMessage || session.slug || session.sessionId;
    const collapsed = index > 0 ? " collapsed" : "";

    // Cumulative changes: all unique files, first backup per file.
    // Hide entries that would produce an empty diff.
    const cumulativeFiles = getCumulativeChanges(session).filter((f) =>
      this._hasCumulativeDiff(session, f)
    );
    const netChangedCount = cumulativeFiles.length;
    const cumulativeHtml = cumulativeFiles
      .map((f) => this._renderFileItem(session, f, "cumulative"))
      .join("");

    // Timeline checkpoints: hide files/checkpoints that would produce empty diffs.
    const timelineCheckpoints = session.snapshots
      .map((snap, originalIndex) => ({
        snap,
        originalIndex,
        files: snap.files.filter((f) => this._hasTimelineDiff(session, snap, f)),
      }))
      .filter((entry) => entry.files.length > 0);
    const totalCheckpointCount = session.snapshots.length;
    const timelineCheckpointCount = timelineCheckpoints.length;
    const hiddenCheckpointCount = totalCheckpointCount - timelineCheckpointCount;
    const timelineCountLabel =
      timelineCheckpointCount === totalCheckpointCount
        ? `${timelineCheckpointCount} checkpoint${timelineCheckpointCount !== 1 ? "s" : ""}`
        : `${timelineCheckpointCount} shown / ${totalCheckpointCount} total`;
    const hiddenCheckpointTooltip =
      hiddenCheckpointCount > 0
        ? ` title="${this._escapeAttr(
            `${hiddenCheckpointCount} checkpoint${hiddenCheckpointCount !== 1 ? "s are" : " is"} hidden because they have no actual diff`
          )}"`
        : "";
    const checkpointsHtml = [...timelineCheckpoints]
      .reverse()
      .map((entry) =>
        this._renderCheckpoint(
          session,
          entry.snap,
          entry.originalIndex,
          entry.files
        )
      )
      .join("");

    return `
      <div class="session${collapsed}" data-session-id="${this._escapeAttr(session.sessionId)}">
        <div class="session-header">
          <svg class="session-chevron" viewBox="0 0 16 16" fill="currentColor">
            <path d="M5.7 13.7L5 13l4.6-4.6L5 3.7l.7-.7 5.3 5.3-5.3 5.4z"/>
          </svg>
          <div class="session-info">
            <div class="session-title" title="${this._escapeAttr(fullTitle)}"><span class="session-dot"></span>${title}</div>
            <div class="session-meta">
              <span class="relative-time">${this._relativeTime(date)}</span>
              <span>${dateStr}, ${timeStr}</span>
            </div>
            <div class="session-meta">
              <span class="badge"${hiddenCheckpointTooltip}>${timelineCountLabel}</span>
              <span class="badge files">${netChangedCount} file${netChangedCount !== 1 ? "s" : ""}</span>
            </div>
          </div>
        </div>
        <div class="session-body">
          <div class="timeline-toggle collapsed" data-session-id="${this._escapeAttr(session.sessionId)}" data-toggle-id="all-changes">
            <div class="timeline-toggle-header">
              <svg class="timeline-toggle-chevron" viewBox="0 0 16 16" fill="currentColor">
                <path d="M5.7 13.7L5 13l4.6-4.6L5 3.7l.7-.7 5.3 5.3-5.3 5.4z"/>
              </svg>
              <span>All Changes</span>
              <span class="badge files">${netChangedCount} file${netChangedCount !== 1 ? "s" : ""}</span>
              <button class="revert-all-btn" data-session-id="${this._escapeAttr(session.sessionId)}" title="Revert all files to before this session">&#x21A9; Revert All</button>
            </div>
            <div class="timeline-toggle-body">
              <div class="cumulative-files">
                ${cumulativeHtml}
              </div>
            </div>
          </div>
          <div class="timeline-toggle" data-session-id="${this._escapeAttr(session.sessionId)}" data-toggle-id="timeline">
            <div class="timeline-toggle-header">
              <svg class="timeline-toggle-chevron" viewBox="0 0 16 16" fill="currentColor">
                <path d="M5.7 13.7L5 13l4.6-4.6L5 3.7l.7-.7 5.3 5.3-5.3 5.4z"/>
              </svg>
              <span>Timeline</span>
              <span class="badge"${hiddenCheckpointTooltip}>${timelineCountLabel}</span>
            </div>
            <div class="timeline-toggle-body">
              <div class="timeline">
                ${checkpointsHtml}
              </div>
            </div>
          </div>
        </div>
      </div>`;
  }

  private _renderCheckpoint(
    session: SessionInfo,
    snapshot: Snapshot,
    index: number,
    files: FileBackup[]
  ): string {
    const date = new Date(snapshot.timestamp);
    const checkpointId = `${session.sessionId}::${snapshot.messageId}`;
    const timeStr = date.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });

    const filesHtml = files
      .map((f) => this._renderFileItem(session, f, "checkpoint", snapshot))
      .join("");

    return `
      <div class="checkpoint collapsed" data-checkpoint-id="${this._escapeAttr(checkpointId)}">
        <div class="checkpoint-header">
          <svg class="checkpoint-chevron" viewBox="0 0 16 16" fill="currentColor">
            <path d="M5.7 13.7L5 13l4.6-4.6L5 3.7l.7-.7 5.3 5.3-5.3 5.4z"/>
          </svg>
          <span class="checkpoint-time">#${index + 1} &middot; ${timeStr}</span>
          <span class="checkpoint-count">${files.length} file${files.length !== 1 ? "s" : ""}</span>
        </div>
        <div class="checkpoint-files">
          ${filesHtml}
        </div>
      </div>`;
  }

  private _hasCumulativeDiff(session: SessionInfo, file: FileBackup): boolean {
    if (file.backupFileName === null) {
      // New file: compare empty -> current.
      if (!fs.existsSync(file.absolutePath)) {
        return false;
      }
      try {
        return fs.readFileSync(file.absolutePath, "utf-8") !== "";
      } catch {
        return true;
      }
    }

    try {
      const backup = readBackupFile(session.sessionId, file.backupFileName);
      if (backup === null) {
        return true;
      }
      if (!fs.existsSync(file.absolutePath)) {
        // Diff is backup -> empty
        return backup !== "";
      }
      const current = fs.readFileSync(file.absolutePath, "utf-8");
      return backup !== current;
    } catch {
      return true;
    }
  }

  private _hasTimelineDiff(
    session: SessionInfo,
    snapshot: Snapshot,
    file: FileBackup
  ): boolean {
    const nextBackup = findNextBackup(session, snapshot.messageId, file.filePath);

    if (file.backupFileName === null) {
      // Created file:
      // - with next backup: empty -> next backup
      // - otherwise: empty -> current (or empty if missing)
      if (nextBackup) {
        const nextContent = readBackupFile(session.sessionId, nextBackup);
        return nextContent === null ? true : nextContent !== "";
      }
      if (!fs.existsSync(file.absolutePath)) {
        return false;
      }
      try {
        return fs.readFileSync(file.absolutePath, "utf-8") !== "";
      } catch {
        return true;
      }
    }

    const backup = readBackupFile(session.sessionId, file.backupFileName);
    if (backup === null) {
      return true;
    }

    if (nextBackup) {
      // Checkpoint mode: backup -> next backup
      const nextContent = readBackupFile(session.sessionId, nextBackup);
      return nextContent === null ? true : backup !== nextContent;
    }

    // Last occurrence: backup -> current (or empty if missing)
    if (!fs.existsSync(file.absolutePath)) {
      return backup !== "";
    }
    try {
      const current = fs.readFileSync(file.absolutePath, "utf-8");
      return backup !== current;
    } catch {
      return true;
    }
  }

  private _renderFileItem(
    session: SessionInfo,
    f: FileBackup,
    mode: "cumulative" | "checkpoint",
    snapshot?: Snapshot
  ): string {
    const fileName = path.basename(f.absolutePath);
    const nextBackup = mode === "checkpoint" && snapshot
      ? findNextBackup(session, snapshot.messageId, f.filePath)
      : null;
    const dirName = path.dirname(f.filePath);
    const displayPath = dirName && dirName !== "."
      ? this._truncateMiddle(dirName, 42)
      : "";
    const fileExists = fs.existsSync(f.absolutePath);
    const isNew = f.backupFileName === null;
    const isDeleted = !isNew && !fileExists;
    const iconClass = isNew ? "added" : isDeleted ? "deleted" : "modified";
    const iconChar = isNew ? "A" : isDeleted ? "D" : "M";
    const revertedKey = this._revertedKey(session.sessionId, f.absolutePath);

    // Only show reverted if user explicitly clicked revert, validated against current state
    let isReverted = false;
    if (this._revertedFiles.has(revertedKey)) {
      if (isNew) {
        isReverted = !fileExists;
      } else {
        try {
          const backup = readBackupFile(session.sessionId, f.backupFileName!);
          const current = fileExists
            ? fs.readFileSync(f.absolutePath, "utf-8")
            : null;
          isReverted = backup !== null && backup === current;
        } catch {
          isReverted = false;
        }
      }
    }

    const revertedBadge = isReverted
      ? `<span class="reverted-badge">reverted</span>`
      : "";
    const actionBtn = isNew
      ? `<button class="action-btn delete-btn" title="Delete (file created by Claude)">&#x1F5D1;</button>`
      : `<button class="action-btn restore-btn" title="Restore">&#x21A9;</button>`;
    const revertedClass = isReverted ? " reverted" : "";

    return `
      <div class="file-item${revertedClass}"
        data-session-id="${this._escapeAttr(session.sessionId)}"
        data-file-path="${this._escapeAttr(f.filePath)}"
        data-absolute-path="${this._escapeAttr(f.absolutePath)}"
        data-backup-file-name="${this._escapeAttr(f.backupFileName ?? "")}"
        data-version="${f.version}"
        data-backup-time="${this._escapeAttr(f.backupTime)}"
        data-mode="${mode}"
        data-next-backup-file-name="${this._escapeAttr(nextBackup ?? "")}">
        <span class="file-icon ${iconClass}">${iconChar}</span>
        <div class="file-main">
          <span class="file-name">${this._escapeHtml(fileName)}</span>
          ${displayPath ? `<span class="file-path" title="${this._escapeAttr(dirName)}">${this._escapeHtml(displayPath)}</span>` : ""}
        </div>
        <div class="file-side">
          ${revertedBadge}
          <div class="file-actions">
            ${isReverted ? "" : actionBtn}
          </div>
        </div>
      </div>`;
  }

  private _relativeTime(date: Date): string {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    const isToday =
      date.getDate() === now.getDate() &&
      date.getMonth() === now.getMonth() &&
      date.getFullYear() === now.getFullYear();

    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const isYesterday =
      date.getDate() === yesterday.getDate() &&
      date.getMonth() === yesterday.getMonth() &&
      date.getFullYear() === yesterday.getFullYear();

    if (isToday) { return "Today"; }
    if (isYesterday) { return "Yesterday"; }
    if (diffDays < 7) { return `${diffDays}d ago`; }
    if (diffDays < 30) { return `${Math.floor(diffDays / 7)}w ago`; }
    return `${Math.floor(diffDays / 30)}mo ago`;
  }

  private _escapeHtml(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  private _escapeAttr(text: string): string {
    return text.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  }

  private _truncateMiddle(text: string, maxLength: number): string {
    if (text.length <= maxLength || maxLength < 8) {
      return text;
    }

    const visible = maxLength - 3;
    const left = Math.ceil(visible / 2);
    const right = Math.floor(visible / 2);
    return `${text.slice(0, left)}...${text.slice(-right)}`;
  }

  private _revertedKey(sessionId: string, absolutePath: string): string {
    return `${sessionId}::${absolutePath}`;
  }
}
