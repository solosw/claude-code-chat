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
exports.getBackupFilePath = getBackupFilePath;
exports.readBackupFile = readBackupFile;
exports.computeFileHash = computeFileHash;
exports.findSessionsForWorkspace = findSessionsForWorkspace;
exports.getCumulativeChanges = getCumulativeChanges;
exports.findNextBackup = findNextBackup;
exports.getFileVersions = getFileVersions;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const crypto = __importStar(require("crypto"));
const readline = __importStar(require("readline"));
const CLAUDE_DIR = path.join(os.homedir(), ".claude");
const FILE_HISTORY_DIR = path.join(CLAUDE_DIR, "file-history");
const PROJECTS_DIR = path.join(CLAUDE_DIR, "projects");
const sessionParseCache = new Map();
/**
 * Convert a workspace folder path to the Claude projects directory name.
 * Claude replaces all non-alphanumeric characters with '-'.
 * Works cross-platform (Linux/macOS/Windows).
 */
function projectDirName(workspacePath) {
    return workspacePath.replace(/[^a-zA-Z0-9]/g, "-");
}
/**
 * Get the backup file path for a session + backup filename.
 */
function getBackupFilePath(sessionId, backupFileName) {
    return path.join(FILE_HISTORY_DIR, sessionId, backupFileName);
}
/**
 * Read the content of a backup file.
 */
function readBackupFile(sessionId, backupFileName) {
    try {
        const filePath = getBackupFilePath(sessionId, backupFileName);
        return fs.readFileSync(filePath, "utf-8");
    }
    catch {
        return null;
    }
}
async function readBackupFileAsync(sessionId, backupFileName, contentCache) {
    const cacheKey = `${sessionId}:${backupFileName}`;
    if (contentCache?.has(cacheKey)) {
        return contentCache.get(cacheKey) ?? null;
    }
    try {
        const filePath = getBackupFilePath(sessionId, backupFileName);
        const content = await fs.promises.readFile(filePath, "utf-8");
        contentCache?.set(cacheKey, content);
        return content;
    }
    catch {
        contentCache?.set(cacheKey, null);
        return null;
    }
}
/**
 * Compute the SHA-256 hash prefix used by Claude for backup filenames.
 */
function computeFileHash(absolutePath) {
    return crypto.createHash("sha256").update(absolutePath).digest("hex").slice(0, 16);
}
/**
 * Find all sessions relevant to a given workspace path.
 */
async function findSessionsForWorkspace(workspacePath, log) {
    const dirName = projectDirName(workspacePath);
    const projectDir = path.join(PROJECTS_DIR, dirName);
    log?.(`Looking for project dir: ${projectDir}`);
    log?.(`Exists: ${fs.existsSync(projectDir)}`);
    if (!fs.existsSync(projectDir)) {
        return [];
    }
    const files = fs.readdirSync(projectDir).filter((f) => f.endsWith(".jsonl"));
    const sessions = [];
    const backupContentCache = new Map();
    const seenJsonlPaths = new Set();
    for (const file of files) {
        const sessionId = file.replace(".jsonl", "");
        const jsonlPath = path.join(projectDir, file);
        const stat = fs.statSync(jsonlPath);
        seenJsonlPaths.add(jsonlPath);
        const cached = sessionParseCache.get(jsonlPath);
        const session = cached && cached.mtimeMs === stat.mtimeMs
            ? cached.session
            : await parseSessionJsonl(sessionId, jsonlPath, workspacePath, stat.mtime, backupContentCache);
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
        if (cachedPath.startsWith(projectDir + path.sep) &&
            !seenJsonlPaths.has(cachedPath)) {
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
async function parseSessionJsonl(sessionId, jsonlPath, workspacePath, lastModified, backupContentCache) {
    const snapshots = [];
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
                    }
                    else if (Array.isArray(content)) {
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
            }
            catch {
                // Skip malformed lines
            }
        }
    }
    catch {
        return null;
    }
    // Merge snapshot updates into their parent snapshots
    const mergedSnapshots = mergeSnapshots(snapshots);
    // Filter out files that didn't actually change
    const filteredSnapshots = await filterUnchangedFiles(sessionId, mergedSnapshots, backupContentCache);
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
function parseSnapshot(entry, cwd) {
    const { snapshot, isSnapshotUpdate } = entry;
    if (!snapshot || !snapshot.trackedFileBackups) {
        return null;
    }
    const files = [];
    for (const [filePath, backup] of Object.entries(snapshot.trackedFileBackups)) {
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
function mergeSnapshots(snapshots) {
    const byMessageId = new Map();
    for (const snap of snapshots) {
        const existing = byMessageId.get(snap.messageId);
        if (existing) {
            // Merge: update files from this snapshot into existing
            const fileMap = new Map();
            for (const f of existing.files) {
                fileMap.set(f.filePath, f);
            }
            for (const f of snap.files) {
                fileMap.set(f.filePath, f);
            }
            existing.files = Array.from(fileMap.values());
            existing.timestamp = snap.timestamp;
        }
        else {
            byMessageId.set(snap.messageId, { ...snap, files: [...snap.files] });
        }
    }
    const result = Array.from(byMessageId.values());
    // Sort chronologically (oldest first for display)
    result.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    return result;
}
/**
 * Get a flat list of all unique files changed across a session.
 * For each file, keeps the FIRST backup (state before Claude first touched it).
 */
function getCumulativeChanges(session) {
    const seen = new Map();
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
function findNextBackup(session, snapshotMessageId, filePath) {
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
async function filterUnchangedFiles(sessionId, snapshots, backupContentCache) {
    // Track the last known backup filename per file path
    const lastBackup = new Map();
    const filtered = [];
    for (const snap of snapshots) {
        const changedFiles = [];
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
                    readBackupFileAsync(sessionId, file.backupFileName, backupContentCache),
                ]);
                if (prevContent !== null &&
                    currContent !== null &&
                    prevContent === currContent) {
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
function getFileVersions(sessionId, fileHash) {
    const sessionDir = path.join(FILE_HISTORY_DIR, sessionId);
    if (!fs.existsSync(sessionDir)) {
        return [];
    }
    const files = fs.readdirSync(sessionDir);
    const versions = [];
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
//# sourceMappingURL=checkpointService.js.map