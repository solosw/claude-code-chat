"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.LatestChangesViewProvider = void 0;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const checkpointService_1 = require("./checkpointService");
class LatestChangesViewProvider {
    static viewType = "claudeChangesLatest";
    _view;
    _workspacePath;
    _log;
    _revertedFiles = new Set();
    constructor(workspacePath, log) {
        this._workspacePath = workspacePath;
        this._log = log;
    }
    refresh() {
        if (this._view) {
            this._update(this._view.webview);
        }
    }
    markFileReverted(sessionId, absolutePath) {
        const key = `${sessionId}::${absolutePath}`;
        this._revertedFiles.add(key);
        this._view?.webview.postMessage({
            command: "markReverted",
            sessionId,
            absolutePath,
        });
    }
    resolveWebviewView(webviewView, _context, _token) {
        this._view = webviewView;
        webviewView.webview.options = { enableScripts: true };
        webviewView.webview.onDidReceiveMessage((message) => {
            switch (message.command) {
                case "viewDiff":
                    vscode.commands.executeCommand("claudeChanges.viewDiffData", message.sessionId, message.filePath, message.absolutePath, message.backupFileName, message.version, message.backupTime, message.mode, message.nextBackupFileName);
                    break;
                case "restoreFile":
                    vscode.commands.executeCommand("claudeChanges.restoreFileData", message.sessionId, message.absolutePath, message.backupFileName, message.version);
                    break;
                case "deleteFile":
                    vscode.commands.executeCommand("claudeChanges.deleteFileData", message.absolutePath, message.sessionId);
                    break;
                case "revertAllLatest":
                    vscode.commands.executeCommand("claudeChanges.revertAllLatestData");
                    break;
                case "refresh":
                    this.refresh();
                    break;
            }
        });
        this._update(webviewView.webview);
    }
    async _update(webview) {
        if (!this._workspacePath) {
            webview.html = this._getEmptyHtml("No workspace folder open");
            return;
        }
        const sessions = await (0, checkpointService_1.findSessionsForWorkspace)(this._workspacePath, this._log);
        if (sessions.length === 0) {
            webview.html = this._getEmptyHtml("No Claude checkpoints found");
            return;
        }
        webview.html = this._getHtml(sessions);
    }
    _getEmptyHtml(message) {
        return `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 16px; display: flex; align-items: center; justify-content: center; min-height: 200px; }
  .empty { text-align: center; opacity: 0.6; font-size: 12px; }
</style></head>
<body><div class="empty">${message}</div></body></html>`;
    }
    _getHtml(sessions) {
        const latestSession = sessions[0];
        const files = this._getLatestFiles(latestSession);
        const sessionTitle = this._escapeHtml(latestSession.firstUserMessage ||
            latestSession.slug ||
            latestSession.sessionId.slice(0, 12));
        const fileCount = files.length;
        const filesHtml = files
            .map((f) => this._renderFileItem(latestSession, f))
            .join("");
        return `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: transparent;
    padding: 0;
    line-height: 1.4;
  }

  /* ── Header ── */
  .header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 8px;
    border-bottom: 1px solid var(--vscode-panel-border, transparent);
    background: color-mix(in srgb, var(--vscode-foreground) 4%, transparent);
  }

  .header-title {
    flex: 1;
    font-size: 12px;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--vscode-foreground);
  }

  .header-badge {
    font-size: 10px;
    padding: 1px 6px;
    border-radius: 8px;
    background: color-mix(in srgb, var(--vscode-gitDecoration-addedResourceForeground, #73c991) 16%, transparent);
    color: var(--vscode-gitDecoration-addedResourceForeground, #73c991);
    font-weight: 500;
    flex-shrink: 0;
  }

  .header-btn {
    background: none;
    border: 1px solid color-mix(in srgb, var(--vscode-foreground) 18%, transparent);
    color: var(--vscode-foreground);
    cursor: pointer;
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 10px;
    font-family: var(--vscode-font-family);
    opacity: 0.75;
    transition: opacity 0.1s, background 0.1s;
    display: flex;
    align-items: center;
    gap: 3px;
    flex-shrink: 0;
  }
  .header-btn:hover { opacity: 1; background: var(--vscode-toolbar-hoverBackground); }
  .header-btn.danger {
    border-color: color-mix(in srgb, var(--vscode-gitDecoration-deletedResourceForeground, #f14c4c) 40%, transparent);
    color: var(--vscode-gitDecoration-deletedResourceForeground, #f14c4c);
  }
  .header-btn.danger:hover {
    background: color-mix(in srgb, var(--vscode-gitDecoration-deletedResourceForeground, #f14c4c) 12%, transparent);
  }
  .header-btn svg { width: 12px; height: 12px; }

  /* ── File List ── */
  .file-list { padding: 4px 5px 8px 5px; }

  /* ── Scrollbar ── */
  ::-webkit-scrollbar { width: 5px; }
  ::-webkit-scrollbar-thumb { background: var(--vscode-scrollbarSlider-background); border-radius: 3px; }
  ::-webkit-scrollbar-thumb:hover { background: var(--vscode-scrollbarSlider-hoverBackground); }

  /* ── File Item ── */
  .file-item {
    display: grid;
    grid-template-columns: 18px minmax(0, 1fr) auto;
    align-items: start;
    gap: 6px;
    padding: 4px 6px;
    border-radius: 5px;
    cursor: pointer;
    transition: background 0.1s;
    font-size: 12px;
    margin-bottom: 1px;
  }
  .file-item:hover { background: var(--vscode-list-hoverBackground); }

  .file-item.reverted { opacity: 0.4; pointer-events: none; }
  .file-item.reverted .file-name { text-decoration: line-through; }
  .file-item.reverted .file-actions { display: none; }
  .reverted-badge {
    font-size: 9px; padding: 0 5px; border-radius: 8px;
    background: color-mix(in srgb, var(--vscode-gitDecoration-addedResourceForeground, #73c991) 20%, transparent);
    color: var(--vscode-gitDecoration-addedResourceForeground, #73c991);
    font-weight: 600; align-self: center;
  }

  .file-icon {
    width: 18px; height: 18px; display: flex; align-items: center;
    justify-content: center; font-size: 10px; font-weight: 700;
    border-radius: 3px; margin-top: 1px;
  }
  .file-icon.added { color: var(--vscode-gitDecoration-addedResourceForeground, #73c991); }
  .file-icon.modified { color: var(--vscode-gitDecoration-modifiedResourceForeground, #e2c08d); }
  .file-icon.deleted { color: var(--vscode-gitDecoration-deletedResourceForeground, #f14c4c); }

  .file-main { min-width: 0; display: flex; flex-direction: column; gap: 1px; }
  .file-name {
    min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    color: var(--vscode-foreground); font-weight: 500; line-height: 1.25;
  }
  .file-meta { font-size: 10px; color: var(--vscode-descriptionForeground); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  .file-side { display: flex; align-items: center; gap: 5px; justify-self: end; min-width: 0; }

  .file-actions {
    display: flex; gap: 2px; flex-shrink: 0; align-self: center;
    opacity: 0; pointer-events: none; transition: opacity 0.12s ease;
  }
  .file-item:hover .file-actions, .file-item:focus-within .file-actions { opacity: 0.95; pointer-events: auto; }

  .action-btn {
    background: none; border: none; color: var(--vscode-foreground); cursor: pointer;
    padding: 2px 4px; border-radius: 3px; font-size: 12px; opacity: 0.7;
    transition: opacity 0.1s, background 0.1s;
  }
  .action-btn:hover { opacity: 1; background: var(--vscode-toolbar-hoverBackground); }

  /* ── Empty ── */
  .no-files { padding: 16px 10px; text-align: center; font-size: 12px; opacity: 0.45; }
</style>
</head>
<body>
  <div class="header">
    <div class="header-title" title="${this._escapeAttr(sessionTitle)}">${sessionTitle}</div>
    <span class="header-badge">${fileCount} file${fileCount !== 1 ? "s" : ""}</span>
    <button class="header-btn danger" id="rejectAllBtn" title="Reject all changes in latest session">
      <svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 8a1 1 0 1 1-2 0 1 1 0 0 1 2 0zm-1-4H3.5a.5.5 0 0 1 0-1H7V2.5a.5.5 0 0 1 1 0V3h3.5a.5.5 0 0 1 0 1H8v8h3.5a.5.5 0 0 1 0 1H8v1.5a.5.5 0 0 1-1 0V13H3.5a.5.5 0 0 1 0-1H7V4z"/></svg>
      <span>Reject All</span>
    </button>
    <button class="header-btn" id="refreshBtn" title="Refresh">
      <svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 3a5 5 0 1 0 1.41 3.41l-.71.71V8H6a1 1 0 0 1 0-2h3.5V5.29A5 5 0 0 0 8 3zm-.71 10l.71.71.71-.71H14a1 1 0 0 0 0-2H7.29l-.71-.71A5 5 0 0 0 2 8h2.5a1 1 0 0 0 0-2H3a5 5 0 0 0 4.29 2.59L8 9.41z"/></svg>
    </button>
  </div>
  <div class="file-list" id="fileList">
    ${filesHtml || '<div class="no-files">No files with changes</div>'}
  </div>
  <script>
    const vscode = acquireVsCodeApi();

    document.getElementById('refreshBtn').addEventListener('click', () => {
      vscode.postMessage({ command: 'refresh' });
    });

    document.getElementById('rejectAllBtn').addEventListener('click', () => {
      vscode.postMessage({ command: 'revertAllLatest' });
    });

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
    });
  </script>
</body></html>`;
    }
    _getLatestFiles(session) {
        if (session.snapshots.length === 0)
            return [];
        const lastSnap = session.snapshots[session.snapshots.length - 1];
        return lastSnap.files.filter((f) => this._hasActualDiff(session, lastSnap, f));
    }
    /**
     * Check if a file has an actual diff between checkpoint and current disk state.
     * Returns true only if the file really differs from its backup.
     */
    _hasActualDiff(session, snapshot, file) {
        const nextBackup = (0, checkpointService_1.findNextBackup)(session, snapshot.messageId, file.filePath);
        if (file.backupFileName === null) {
            // New file: check if it's still different from empty
            if (nextBackup) {
                const nextContent = (0, checkpointService_1.readBackupFile)(session.sessionId, nextBackup);
                return nextContent === null || nextContent !== "";
            }
            if (!fs.existsSync(file.absolutePath))
                return false;
            try {
                return fs.readFileSync(file.absolutePath, "utf-8") !== "";
            }
            catch {
                return true;
            }
        }
        const backup = (0, checkpointService_1.readBackupFile)(session.sessionId, file.backupFileName);
        if (backup === null)
            return true;
        if (!fs.existsSync(file.absolutePath)) {
            // File was deleted — show as deleted (diff is backup -> empty)
            return backup !== "";
        }
        try {
            const current = fs.readFileSync(file.absolutePath, "utf-8");
            return backup !== current;
        }
        catch {
            return true;
        }
    }
    _renderFileItem(session, f) {
        const fileName = path.basename(f.absolutePath);
        const dirName = path.dirname(f.filePath);
        const displayDir = dirName && dirName !== "." ? this._truncateMiddle(dirName, 36) : "";
        const fileExists = fs.existsSync(f.absolutePath);
        const isNew = f.backupFileName === null;
        const isDeleted = !isNew && !fileExists;
        const iconClass = isNew ? "added" : isDeleted ? "deleted" : "modified";
        const iconChar = isNew ? "A" : isDeleted ? "D" : "M";
        const lastSnap = session.snapshots[session.snapshots.length - 1];
        const nextBackup = (0, checkpointService_1.findNextBackup)(session, lastSnap.messageId, f.filePath);
        const revertedKey = `${session.sessionId}::${f.absolutePath}`;
        let isReverted = false;
        if (this._revertedFiles.has(revertedKey)) {
            // Validate against disk: if backup matches current, it's truly reverted
            if (isNew) {
                isReverted = !fileExists;
            }
            else {
                try {
                    const backup = (0, checkpointService_1.readBackupFile)(session.sessionId, f.backupFileName);
                    const current = fileExists ? fs.readFileSync(f.absolutePath, "utf-8") : null;
                    isReverted = backup !== null && backup === current;
                }
                catch {
                    isReverted = false;
                }
            }
        }
        const revertedBadge = isReverted ? `<span class="reverted-badge">reverted</span>` : "";
        const actionBtn = isNew
            ? `<button class="action-btn delete-btn" title="Delete">&#x1F5D1;</button>`
            : `<button class="action-btn restore-btn" title="Restore">&#x21A9;</button>`;
        const revertedClass = isReverted ? " reverted" : "";
        const date = new Date(f.backupTime);
        const timeLabel = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        return `
      <div class="file-item${revertedClass}"
        data-session-id="${this._escapeAttr(session.sessionId)}"
        data-file-path="${this._escapeAttr(f.filePath)}"
        data-absolute-path="${this._escapeAttr(f.absolutePath)}"
        data-backup-file-name="${this._escapeAttr(f.backupFileName ?? "")}"
        data-version="${f.version}"
        data-backup-time="${this._escapeAttr(f.backupTime)}"
        data-mode="checkpoint"
        data-next-backup-file-name="${this._escapeAttr(nextBackup ?? "")}">
        <span class="file-icon ${iconClass}">${iconChar}</span>
        <div class="file-main">
          <span class="file-name">${this._escapeHtml(fileName)}</span>
          <span class="file-meta">${timeLabel}${displayDir ? " · " + displayDir : ""}</span>
        </div>
        <div class="file-side">
          ${revertedBadge}
          <div class="file-actions">${isReverted ? "" : actionBtn}</div>
        </div>
      </div>`;
    }
    _escapeHtml(text) {
        return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    }
    _escapeAttr(text) {
        return text.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
    }
    _truncateMiddle(text, maxLength) {
        if (text.length <= maxLength || maxLength < 8)
            return text;
        const visible = maxLength - 3;
        return `${text.slice(0, Math.ceil(visible / 2))}...${text.slice(-Math.floor(visible / 2))}`;
    }
}
exports.LatestChangesViewProvider = LatestChangesViewProvider;
//# sourceMappingURL=latestChangesPanel.js.map