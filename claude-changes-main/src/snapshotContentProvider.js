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
exports.SnapshotContentProvider = exports.SCHEME = void 0;
exports.buildCheckpointUri = buildCheckpointUri;
const vscode = __importStar(require("vscode"));
const checkpointService_1 = require("./checkpointService");
/**
 * URI scheme: claude-checkpoint:///<sessionId>/<backupFileName>/<fileNameHint>
 * The optional filename hint preserves extension so VS Code can infer language mode.
 */
exports.SCHEME = "claude-checkpoint";
class SnapshotContentProvider {
    _onDidChange = new vscode.EventEmitter();
    onDidChange = this._onDidChange.event;
    provideTextDocumentContent(uri) {
        const parts = uri.path.split("/").filter(Boolean);
        if (parts.length < 2) {
            return "";
        }
        const sessionId = decodeURIComponent(parts[0]);
        if (sessionId === "empty") {
            return "";
        }
        const backupFileName = decodeURIComponent(parts[1]);
        const content = (0, checkpointService_1.readBackupFile)(sessionId, backupFileName);
        return content ?? "";
    }
}
exports.SnapshotContentProvider = SnapshotContentProvider;
/**
 * Build a URI for viewing a checkpoint backup file.
 */
function buildCheckpointUri(sessionId, backupFileName, fileNameHint) {
    const safeHint = (fileNameHint || "file.txt").replace(/[\\/]/g, "_");
    return vscode.Uri.parse(`${exports.SCHEME}:///${encodeURIComponent(sessionId)}/${encodeURIComponent(backupFileName)}/${encodeURIComponent(safeHint)}`);
}
//# sourceMappingURL=snapshotContentProvider.js.map