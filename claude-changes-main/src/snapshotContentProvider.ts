import * as vscode from "vscode";
import { readBackupFile } from "./checkpointService";

/**
 * URI scheme: claude-checkpoint:///<sessionId>/<backupFileName>/<fileNameHint>
 * The optional filename hint preserves extension so VS Code can infer language mode.
 */
export const SCHEME = "claude-checkpoint";

export class SnapshotContentProvider
  implements vscode.TextDocumentContentProvider
{
  private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this._onDidChange.event;

  provideTextDocumentContent(uri: vscode.Uri): string {
    const parts = uri.path.split("/").filter(Boolean);
    if (parts.length < 2) {
      return "";
    }

    const sessionId = decodeURIComponent(parts[0]);
    if (sessionId === "empty") {
      return "";
    }
    const backupFileName = decodeURIComponent(parts[1]);

    const content = readBackupFile(sessionId, backupFileName);
    return content ?? "";
  }
}

/**
 * Build a URI for viewing a checkpoint backup file.
 */
export function buildCheckpointUri(
  sessionId: string,
  backupFileName: string,
  fileNameHint: string
): vscode.Uri {
  const safeHint = (fileNameHint || "file.txt").replace(/[\\/]/g, "_");
  return vscode.Uri.parse(
    `${SCHEME}:///${encodeURIComponent(sessionId)}/${encodeURIComponent(
      backupFileName
    )}/${encodeURIComponent(safeHint)}`
  );
}
