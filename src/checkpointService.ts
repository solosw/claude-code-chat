import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as crypto from "crypto";
import * as readline from "readline";

export interface FileBackup {
  filePath: string; // relative or absolute as stored
  absolutePath: string; // resolved absolute path
  backupFileName: string | null;
  version: number;
  backupTime: string;
}

export interface Snapshot {
  messageId: string;
  timestamp: string;
  files: FileBackup[];
  isUpdate: boolean;
}

export interface SessionInfo {
  sessionId: string;
  projectPath: string;
  jsonlPath: string;
  cwd: string;
  lastActivity: Date;
  snapshots: Snapshot[];
  firstUserMessage: string;
  slug: string;
}

const CLAUDE_DIR = path.join(os.homedir(), ".claude");
const FILE_HISTORY_DIR = path.join(CLAUDE_DIR, "file-history");
const PROJECTS_DIR = path.join(CLAUDE_DIR, "projects");
const sessionParseCache = new Map<
  string,
  { mtimeMs: number; session: SessionInfo | null }
>();

/**
 * Convert a workspace folder path to the Claude projects directory name.
 * Claude replaces all non-alphanumeric characters with '-'.
 * Works cross-platform (Linux/macOS/Windows).
 */
function projectDirName(workspacePath: string): string {
  return workspacePath.replace(/[^a-zA-Z0-9]/g, "-");
}

/**
 * Get the backup file path for a session + backup filename.
 */
export function getBackupFilePath(
  sessionId: string,
  backupFileName: string
): string {
  return path.join(FILE_HISTORY_DIR, sessionId, backupFileName);
}

/**
 * Read the content of a backup file.
 */
export function readBackupFile(
  sessionId: string,
  backupFileName: string
): string | null {
  try {
    const filePath = getBackupFilePath(sessionId, backupFileName);
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

async function readBackupFileAsync(
  sessionId: string,
  backupFileName: string,
  contentCache?: Map<string, string | null>
): Promise<string | null> {
  const cacheKey = `${sessionId}:${backupFileName}`;
  if (contentCache?.has(cacheKey)) {
    return contentCache.get(cacheKey) ?? null;
  }

  try {
    const filePath = getBackupFilePath(sessionId, backupFileName);
    const content = await fs.promises.readFile(filePath, "utf-8");
    contentCache?.set(cacheKey, content);
    return content;
  } catch {
    contentCache?.set(cacheKey, null);
    return null;
  }
}

/**
 * Compute the SHA-256 hash prefix used by Claude for backup filenames.
 */
export function computeFileHash(absolutePath: string): string {
  return crypto.createHash("sha256").update(absolutePath).digest("hex").slice(0, 16);
}

/**
 * Find all sessions relevant to a given workspace path.
 */
export async function findSessionsForWorkspace(
  workspacePath: string,
  log?: (msg: string) => void
): Promise<SessionInfo[]> {
  const dirName = projectDirName(workspacePath);
  const projectDir = path.join(PROJECTS_DIR, dirName);

  log?.(`Looking for project dir: ${projectDir}`);
  log?.(`Exists: ${fs.existsSync(projectDir)}`);

  if (!fs.existsSync(projectDir)) {
    return [];
  }

  const files = fs.readdirSync(projectDir).filter((f) => f.endsWith(".jsonl"));
  const sessions: SessionInfo[] = [];
  const backupContentCache = new Map<string, string | null>();
  const seenJsonlPaths = new Set<string>();

  for (const file of files) {
    const sessionId = file.replace(".jsonl", "");
    const jsonlPath = path.join(projectDir, file);
    const stat = fs.statSync(jsonlPath);
    seenJsonlPaths.add(jsonlPath);

    const cached = sessionParseCache.get(jsonlPath);
    const session =
      cached && cached.mtimeMs === stat.mtimeMs
        ? cached.session
        : await parseSessionJsonl(
            sessionId,
            jsonlPath,
            workspacePath,
            stat.mtime,
            backupContentCache
          );

    if (!cached || cached.mtimeMs !== stat.mtimeMs) {
      sessionParseCache.set(jsonlPath, {
        mtimeMs: stat.mtimeMs,
        session,
      });
    }

    if (session && session.snapshots.length > 0) {
      sessions.push(session);
    }
  }

  // Keep the cache bounded to currently present JSONL files for this workspace.
  for (const cachedPath of sessionParseCache.keys()) {
    if (
      cachedPath.startsWith(projectDir + path.sep) &&
      !seenJsonlPaths.has(cachedPath)
    ) {
      sessionParseCache.delete(cachedPath);
    }
  }

  // Sort by most recent activity first
  sessions.sort((a, b) => b.lastActivity.getTime() - a.lastActivity.getTime());

  return sessions;
}

/**
 * Parse a session JSONL file to extract snapshots and CWD.
 */
async function parseSessionJsonl(
  sessionId: string,
  jsonlPath: string,
  workspacePath: string,
  lastModified: Date,
  backupContentCache: Map<string, string | null>
): Promise<SessionInfo | null> {
  const snapshots: Snapshot[] = [];
  let cwd = workspacePath;
  let firstUserMessage = "";
  let slug = "";

  try {
    const fileStream = fs.createReadStream(jsonlPath, { encoding: "utf-8" });
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });

    for await (const line of rl) {
      if (!line.trim()) {
        continue;
      }

      try {
        const entry = JSON.parse(line);

        // Extract cwd from messages
        if (entry.cwd) {
          cwd = entry.cwd;
        }

        // Extract slug
        if (entry.slug && !slug) {
          slug = entry.slug;
        }

        // Extract first real user message text (skip IDE context tags)
        if (entry.type === "user" && !firstUserMessage && entry.message?.content) {
          const content = entry.message.content;
          let candidate = "";
          if (typeof content === "string") {
            candidate = content;
          } else if (Array.isArray(content)) {
            for (const block of content) {
              if (block.type === "text" && block.text) {
                candidate = block.text;
                break;
              }
            }
          }
          // Strip IDE context tags and check if real text remains
          const cleaned = candidate
            .replace(/<ide_[^>]*>[\s\S]*?<\/ide_[^>]*>/g, "")
            .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "")
            .trim();
          if (cleaned) {
            firstUserMessage = cleaned;
          }
        }

        // Extract file-history-snapshot entries
        if (entry.type === "file-history-snapshot" && entry.snapshot) {
          const snapshot = parseSnapshot(entry, cwd);
          if (snapshot) {
            snapshots.push(snapshot);
          }
        }
      } catch {
        // Skip malformed lines
      }
    }
  } catch {
    return null;
  }

  // Merge snapshot updates into their parent snapshots
  const mergedSnapshots = mergeSnapshots(snapshots);

  // Filter out files that didn't actually change
  const filteredSnapshots = await filterUnchangedFiles(
    sessionId,
    mergedSnapshots,
    backupContentCache
  );

  return {
    sessionId,
    projectPath: workspacePath,
    jsonlPath,
    cwd,
    lastActivity: lastModified,
    snapshots: filteredSnapshots,
    firstUserMessage: firstUserMessage.slice(0, 120),
    slug,
  };
}

function parseSnapshot(entry: any, cwd: string): Snapshot | null {
  const { snapshot, isSnapshotUpdate } = entry;
  if (!snapshot || !snapshot.trackedFileBackups) {
    return null;
  }

  const files: FileBackup[] = [];

  for (const [filePath, backup] of Object.entries<any>(
    snapshot.trackedFileBackups
  )) {
    const absolutePath = path.isAbsolute(filePath)
      ? filePath
      : path.join(cwd, filePath);

    files.push({
      filePath,
      absolutePath,
      backupFileName: backup.backupFileName,
      version: backup.version,
      backupTime: backup.backupTime,
    });
  }

  return {
    messageId: snapshot.messageId,
    timestamp: snapshot.timestamp,
    files,
    isUpdate: isSnapshotUpdate === true,
  };
}

/**
 * Merge snapshot updates into their parent snapshots (same messageId).
 * Only keep the final state per messageId.
 */
function mergeSnapshots(snapshots: Snapshot[]): Snapshot[] {
  const byMessageId = new Map<string, Snapshot>();

  for (const snap of snapshots) {
    const existing = byMessageId.get(snap.messageId);
    if (existing) {
      // Merge: update files from this snapshot into existing
      const fileMap = new Map<string, FileBackup>();
      for (const f of existing.files) {
        fileMap.set(f.filePath, f);
      }
      for (const f of snap.files) {
        fileMap.set(f.filePath, f);
      }
      existing.files = Array.from(fileMap.values());
      existing.timestamp = snap.timestamp;
    } else {
      byMessageId.set(snap.messageId, { ...snap, files: [...snap.files] });
    }
  }

  const result = Array.from(byMessageId.values());
  // Sort chronologically (oldest first for display)
  result.sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
  return result;
}

/**
 * Get a flat list of all unique files changed across a session.
 * For each file, keeps the FIRST backup (state before Claude first touched it).
 */
export function getCumulativeChanges(session: SessionInfo): FileBackup[] {
  const seen = new Map<string, FileBackup>();

  for (const snap of session.snapshots) {
    for (const file of snap.files) {
      if (!seen.has(file.filePath)) {
        seen.set(file.filePath, file);
      }
    }
  }

  return Array.from(seen.values());
}

/**
 * Find the next backup filename for a file after a given snapshot in a session.
 * Returns the backup filename from the next snapshot that contains this file,
 * or null if this is the last occurrence.
 */
export function findNextBackup(
  session: SessionInfo,
  snapshotMessageId: string,
  filePath: string
): string | null {
  let foundCurrent = false;

  for (const snap of session.snapshots) {
    if (snap.messageId === snapshotMessageId) {
      foundCurrent = true;
      continue;
    }
    if (foundCurrent) {
      const file = snap.files.find((f) => f.filePath === filePath);
      if (file && file.backupFileName) {
        return file.backupFileName;
      }
    }
  }

  return null;
}

/**
 * Filter out files whose backup content is identical to the previous version
 * or to the current file on disk (meaning no real change happened).
 */
async function filterUnchangedFiles(
  sessionId: string,
  snapshots: Snapshot[],
  backupContentCache: Map<string, string | null>
): Promise<Snapshot[]> {
  // Track the last known backup filename per file path
  const lastBackup = new Map<string, string | null>();

  const filtered: Snapshot[] = [];

  for (const snap of snapshots) {
    const changedFiles: FileBackup[] = [];

    for (const file of snap.files) {
      const prev = lastBackup.get(file.filePath);
      lastBackup.set(file.filePath, file.backupFileName);

      // New file (no backup) — always include
      if (file.backupFileName === null) {
        changedFiles.push(file);
        continue;
      }

      // First time seeing this file — always include (backup exists = file was edited)
      if (prev === undefined) {
        changedFiles.push(file);
        continue;
      }

      // Same backup as previous snapshot — no change
      if (prev === file.backupFileName) {
        continue;
      }

      // Different backup versions — compare content
      if (prev !== null) {
        const [prevContent, currContent] = await Promise.all([
          readBackupFileAsync(sessionId, prev, backupContentCache),
          readBackupFileAsync(
            sessionId,
            file.backupFileName,
            backupContentCache
          ),
        ]);

        if (
          prevContent !== null &&
          currContent !== null &&
          prevContent === currContent
        ) {
          continue;
        }
      }

      changedFiles.push(file);
    }

    if (changedFiles.length > 0) {
      filtered.push({ ...snap, files: changedFiles });
    }
  }

  return filtered;
}

/**
 * Get all available backup versions for a specific file in a session.
 */
export function getFileVersions(
  sessionId: string,
  fileHash: string
): { version: number; backupFileName: string; mtime: Date }[] {
  const sessionDir = path.join(FILE_HISTORY_DIR, sessionId);
  if (!fs.existsSync(sessionDir)) {
    return [];
  }

  const files = fs.readdirSync(sessionDir);
  const versions: { version: number; backupFileName: string; mtime: Date }[] =
    [];

  for (const file of files) {
    const match = file.match(/^(.+)@v(\d+)$/);
    if (match && match[1] === fileHash) {
      const stat = fs.statSync(path.join(sessionDir, file));
      versions.push({
        version: parseInt(match[2], 10),
        backupFileName: file,
        mtime: stat.mtime,
      });
    }
  }

  versions.sort((a, b) => a.version - b.version);
  return versions;
}
