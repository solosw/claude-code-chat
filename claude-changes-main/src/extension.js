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
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const snapshotContentProvider_1 = require("./snapshotContentProvider");
const checkpointWebviewProvider_1 = require("./checkpointWebviewProvider");
const latestChangesPanel_1 = require("./latestChangesPanel");
const checkpointService_1 = require("./checkpointService");
const log = vscode.window.createOutputChannel("Claude Changes");
function parseBackupVersion(backupFileName) {
    if (!backupFileName) {
        return null;
    }
    const match = backupFileName.match(/@v(\d+)$/);
    return match ? parseInt(match[1], 10) : null;
}
function activate(context) {
    const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    log.appendLine(`Workspace path: ${workspacePath ?? "NONE"}`);
    // Register content provider for viewing checkpoint files
    const contentProvider = new snapshotContentProvider_1.SnapshotContentProvider();
    context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider(snapshotContentProvider_1.SCHEME, contentProvider));
    // Register webview provider
    const webviewProvider = new checkpointWebviewProvider_1.CheckpointWebviewProvider(workspacePath, (msg) => log.appendLine(msg));
    context.subscriptions.push(vscode.window.registerWebviewViewProvider(checkpointWebviewProvider_1.CheckpointWebviewProvider.viewType, webviewProvider));
    // Register latest changes view provider
    const latestViewProvider = new latestChangesPanel_1.LatestChangesViewProvider(workspacePath, (msg) => log.appendLine(msg));
    context.subscriptions.push(vscode.window.registerWebviewViewProvider(latestChangesPanel_1.LatestChangesViewProvider.viewType, latestViewProvider));
    // Refresh commands
    context.subscriptions.push(vscode.commands.registerCommand("claudeChanges.refresh", () => {
        webviewProvider.refresh();
    }));
    context.subscriptions.push(vscode.commands.registerCommand("claudeChanges.refreshLatest", () => {
        latestViewProvider.refresh();
    }));
    // Auto-refresh: watch the project's JSONL directory for changes
    if (workspacePath) {
        const projectDirName = workspacePath.replace(/[^a-zA-Z0-9]/g, "-");
        const projectDir = path.join(os.homedir(), ".claude", "projects", projectDirName);
        let debounceTimer;
        const debouncedRefresh = () => {
            if (debounceTimer) {
                clearTimeout(debounceTimer);
            }
            debounceTimer = setTimeout(() => {
                log.appendLine("Auto-refresh: checkpoint data changed");
                webviewProvider.refresh();
                latestViewProvider.refresh();
            }, 500);
        };
        try {
            if (fs.existsSync(projectDir)) {
                const watcher = fs.watch(projectDir, (_eventType, filename) => {
                    if (filename?.endsWith(".jsonl")) {
                        debouncedRefresh();
                    }
                });
                context.subscriptions.push({ dispose: () => watcher.close() });
                log.appendLine(`Watching for changes: ${projectDir}`);
            }
            else {
                const pollInterval = setInterval(() => {
                    if (fs.existsSync(projectDir)) {
                        clearInterval(pollInterval);
                        const watcher = fs.watch(projectDir, (_eventType, filename) => {
                            if (filename?.endsWith(".jsonl")) {
                                debouncedRefresh();
                            }
                        });
                        context.subscriptions.push({ dispose: () => watcher.close() });
                        log.appendLine(`Watching for changes (delayed): ${projectDir}`);
                    }
                }, 5000);
                context.subscriptions.push({ dispose: () => clearInterval(pollInterval) });
            }
        }
        catch (err) {
            log.appendLine(`File watcher error: ${err.message}`);
        }
    }
    // View diff command (from webview messages)
    context.subscriptions.push(vscode.commands.registerCommand("claudeChanges.viewDiffData", async (sessionId, _filePath, absolutePath, backupFileName, version, backupTime, mode, nextBackupFileName) => {
        log.appendLine(`viewDiffData: session=${sessionId}, absolutePath=${absolutePath}, backup=${backupFileName}, version=${version}, mode=${mode}, next=${nextBackupFileName}`);
        const fileName = path.basename(absolutePath);
        const date = new Date(backupTime);
        const timeLabel = date.toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
        });
        const emptyUri = vscode.Uri.parse(`${snapshotContentProvider_1.SCHEME}:///empty/empty`);
        const nextVersion = parseBackupVersion(nextBackupFileName);
        if (!backupFileName) {
            // Newly created file.
            // In checkpoint mode, prefer empty -> next checkpoint backup.
            if (mode === "checkpoint" && nextBackupFileName) {
                const nextUri = (0, snapshotContentProvider_1.buildCheckpointUri)(sessionId, nextBackupFileName, fileName);
                const nextLabel = nextVersion !== null ? `v${nextVersion}` : "next checkpoint";
                await vscode.commands.executeCommand("vscode.diff", emptyUri, nextUri, `${fileName}: created at ${timeLabel} \u2194 ${nextLabel}`);
                return;
            }
            const currentUri = vscode.Uri.file(absolutePath);
            if (fs.existsSync(absolutePath)) {
                const label = mode === "checkpoint"
                    ? `${fileName}: created at ${timeLabel} \u2194 current (may include later edits)`
                    : `${fileName} (new file at ${timeLabel})`;
                await vscode.commands.executeCommand("vscode.diff", emptyUri, currentUri, label);
            }
            else {
                vscode.window.showInformationMessage(`File was created but no longer exists: ${absolutePath}`);
            }
            return;
        }
        const checkpointUri = (0, snapshotContentProvider_1.buildCheckpointUri)(sessionId, backupFileName, fileName);
        // Timeline mode: diff checkpoint vs next checkpoint (or current if last)
        if (mode === "checkpoint" && nextBackupFileName) {
            const nextUri = (0, snapshotContentProvider_1.buildCheckpointUri)(sessionId, nextBackupFileName, fileName);
            const nextLabel = nextVersion !== null ? `v${nextVersion}` : "next checkpoint";
            await vscode.commands.executeCommand("vscode.diff", checkpointUri, nextUri, `${fileName}: v${version} (${timeLabel}) \u2194 ${nextLabel}`);
            return;
        }
        // Cumulative mode or last checkpoint: diff vs current file
        const currentUri = vscode.Uri.file(absolutePath);
        if (fs.existsSync(absolutePath)) {
            const label = mode === "checkpoint"
                ? `${fileName}: v${version} (${timeLabel}) \u2194 current (may include later edits)`
                : `${fileName}: checkpoint v${version} (${timeLabel}) \u2194 current`;
            await vscode.commands.executeCommand("vscode.diff", checkpointUri, currentUri, label);
        }
        else {
            await vscode.commands.executeCommand("vscode.diff", checkpointUri, emptyUri, `${fileName}: checkpoint v${version} (${timeLabel}) \u2192 deleted`);
        }
    }));
    // Restore file command (from webview messages)
    context.subscriptions.push(vscode.commands.registerCommand("claudeChanges.restoreFileData", async (sessionId, absolutePath, backupFileName, version) => {
        if (!backupFileName) {
            // File was created by Claude — offer to delete it
            await vscode.commands.executeCommand("claudeChanges.deleteFileData", absolutePath, sessionId);
            return;
        }
        const confirm = await vscode.window.showWarningMessage(`Restore ${path.basename(absolutePath)} to checkpoint v${version}? This will overwrite the current file.`, { modal: true }, "Restore");
        if (confirm !== "Restore") {
            return;
        }
        const content = (0, checkpointService_1.readBackupFile)(sessionId, backupFileName);
        if (content === null) {
            vscode.window.showErrorMessage(`Could not read backup file: ${backupFileName}`);
            return;
        }
        try {
            const dir = path.dirname(absolutePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(absolutePath, content, "utf-8");
            webviewProvider.markFileReverted(sessionId, absolutePath);
            latestViewProvider.markFileReverted(sessionId, absolutePath);
            vscode.window.showInformationMessage(`Restored ${path.basename(absolutePath)} to checkpoint v${version}`);
        }
        catch (err) {
            vscode.window.showErrorMessage(`Failed to restore file: ${err.message}`);
        }
    }));
    // Delete file command (for files created by Claude)
    context.subscriptions.push(vscode.commands.registerCommand("claudeChanges.deleteFileData", async (absolutePath, sessionId) => {
        log.appendLine(`deleteFileData called: ${absolutePath}`);
        const fileName = path.basename(absolutePath);
        if (!fs.existsSync(absolutePath)) {
            vscode.window.showInformationMessage(`${fileName} has already been deleted.`);
            return;
        }
        const confirm = await vscode.window.showWarningMessage(`Delete ${fileName}? This file was created by Claude and will be permanently deleted.`, { modal: true }, "Delete");
        if (confirm !== "Delete") {
            return;
        }
        try {
            fs.unlinkSync(absolutePath);
            if (sessionId) {
                webviewProvider.markFileReverted(sessionId, absolutePath);
                latestViewProvider.markFileReverted(sessionId, absolutePath);
            }
            const dir = path.dirname(absolutePath);
            const isEmpty = fs.readdirSync(dir).length === 0;
            const msg = isEmpty
                ? `Deleted ${fileName}. Note: the parent folder "${path.basename(dir)}/" is now empty and can be removed manually.`
                : `Deleted ${fileName}`;
            vscode.window.showInformationMessage(msg);
        }
        catch (err) {
            vscode.window.showErrorMessage(`Failed to delete file: ${err.message}`);
        }
    }));
    // Revert All command
    context.subscriptions.push(vscode.commands.registerCommand("claudeChanges.revertAllData", async (sessionId) => {
        if (!workspacePath) {
            return;
        }
        const sessions = await (0, checkpointService_1.findSessionsForWorkspace)(workspacePath);
        const session = sessions.find((s) => s.sessionId === sessionId);
        if (!session) {
            vscode.window.showErrorMessage("Session not found.");
            return;
        }
        const files = (0, checkpointService_1.getCumulativeChanges)(session);
        const modified = files.filter((f) => f.backupFileName !== null);
        const created = files.filter((f) => f.backupFileName === null && fs.existsSync(f.absolutePath));
        if (modified.length === 0 && created.length === 0) {
            vscode.window.showInformationMessage("No files to revert.");
            return;
        }
        const parts = [];
        if (modified.length > 0) {
            parts.push(`restore ${modified.length} modified file${modified.length !== 1 ? "s" : ""}`);
        }
        if (created.length > 0) {
            parts.push(`delete ${created.length} created file${created.length !== 1 ? "s" : ""}`);
        }
        const confirm = await vscode.window.showWarningMessage(`Revert all changes? This will ${parts.join(" and ")}.`, { modal: true }, "Revert All");
        if (confirm !== "Revert All") {
            return;
        }
        let restored = 0;
        let deleted = 0;
        let failed = 0;
        const revertedPaths = [];
        for (const file of modified) {
            const content = (0, checkpointService_1.readBackupFile)(session.sessionId, file.backupFileName);
            if (content === null) {
                failed++;
                continue;
            }
            try {
                const dir = path.dirname(file.absolutePath);
                if (!fs.existsSync(dir)) {
                    fs.mkdirSync(dir, { recursive: true });
                }
                fs.writeFileSync(file.absolutePath, content, "utf-8");
                restored++;
                revertedPaths.push(file.absolutePath);
            }
            catch {
                failed++;
            }
        }
        for (const file of created) {
            try {
                fs.unlinkSync(file.absolutePath);
                deleted++;
                revertedPaths.push(file.absolutePath);
            }
            catch {
                failed++;
            }
        }
        if (revertedPaths.length > 0) {
            webviewProvider.markAllReverted(sessionId, revertedPaths);
            for (const p of revertedPaths) {
                latestViewProvider.markFileReverted(sessionId, p);
            }
        }
        const msgParts = [];
        if (restored > 0) {
            msgParts.push(`${restored} restored`);
        }
        if (deleted > 0) {
            msgParts.push(`${deleted} deleted`);
        }
        const msg = msgParts.join(", ");
        if (failed > 0) {
            const warningPrefix = msg ? `${msg}, ` : "";
            vscode.window.showWarningMessage(`${warningPrefix}${failed} failed.`);
        }
        else {
            vscode.window.showInformationMessage(`Reverted: ${msg}.`);
        }
    }));
    // Revert All Latest Session command (for floating panel)
    context.subscriptions.push(vscode.commands.registerCommand("claudeChanges.revertAllLatestData", async () => {
        if (!workspacePath) {
            return;
        }
        const sessions = await (0, checkpointService_1.findSessionsForWorkspace)(workspacePath);
        if (sessions.length === 0) {
            vscode.window.showInformationMessage("No sessions found.");
            return;
        }
        const session = sessions[0]; // latest session
        const files = (0, checkpointService_1.getCumulativeChanges)(session);
        const modified = files.filter((f) => f.backupFileName !== null);
        const created = files.filter((f) => f.backupFileName === null && fs.existsSync(f.absolutePath));
        if (modified.length === 0 && created.length === 0) {
            vscode.window.showInformationMessage("No files to revert.");
            return;
        }
        const parts = [];
        if (modified.length > 0) {
            parts.push(`restore ${modified.length} modified`);
        }
        if (created.length > 0) {
            parts.push(`delete ${created.length} created`);
        }
        const confirm = await vscode.window.showWarningMessage(`Reject all changes in latest session? This will ${parts.join(" and ")}.`, { modal: true }, "Reject All");
        if (confirm !== "Reject All") {
            return;
        }
        let restored = 0;
        let deleted = 0;
        let failed = 0;
        const revertedPaths = [];
        for (const file of modified) {
            const content = (0, checkpointService_1.readBackupFile)(session.sessionId, file.backupFileName);
            if (content === null) {
                failed++;
                continue;
            }
            try {
                const dir = path.dirname(file.absolutePath);
                if (!fs.existsSync(dir)) {
                    fs.mkdirSync(dir, { recursive: true });
                }
                fs.writeFileSync(file.absolutePath, content, "utf-8");
                restored++;
                revertedPaths.push(file.absolutePath);
            }
            catch {
                failed++;
            }
        }
        for (const file of created) {
            try {
                fs.unlinkSync(file.absolutePath);
                deleted++;
                revertedPaths.push(file.absolutePath);
            }
            catch {
                failed++;
            }
        }
        if (revertedPaths.length > 0) {
            webviewProvider.markAllReverted(session.sessionId, revertedPaths);
            for (const p of revertedPaths) {
                latestViewProvider.markFileReverted(session.sessionId, p);
            }
        }
        const msgParts = [];
        if (restored > 0) {
            msgParts.push(`${restored} restored`);
        }
        if (deleted > 0) {
            msgParts.push(`${deleted} deleted`);
        }
        const msg = msgParts.join(", ");
        if (failed > 0) {
            const warningPrefix = msg ? `${msg}, ` : "";
            vscode.window.showWarningMessage(`${warningPrefix}${failed} failed.`);
        }
        else {
            vscode.window.showInformationMessage(`Rejected: ${msg}.`);
        }
        latestViewProvider.refresh();
    }));
}
function deactivate() { }
//# sourceMappingURL=extension.js.map