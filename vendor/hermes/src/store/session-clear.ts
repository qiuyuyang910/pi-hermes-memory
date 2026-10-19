import * as fs from "node:fs";
import * as path from "node:path";
import { DatabaseManager } from "./db.js";
import { AGENT_ROOT } from "../paths.js";

export const SESSION_CLEAR_PREFIX = "roles-hermes:cleared-session:";
const COMPLETE = JSON.stringify({ status: "cleared" });

export interface SessionClearRequest {
  sessionId: string;
  file?: string;
  cwd: string;
  historyMemoryDir?: string;
}

export interface SessionClearTask {
  request: SessionClearRequest;
  state: "scheduled" | "cleared" | "failed";
  error?: string;
}

export function validateSessionClear(request: SessionClearRequest): void {
  if (!request.sessionId || !request.cwd) throw new Error("Current session identity is missing");
  if (request.file) {
    const relative = path.relative(path.toNamespacedPath(path.join(AGENT_ROOT, "sessions")), path.toNamespacedPath(path.resolve(request.file)));
    if (relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative))
      throw new Error("Only sessions in Pi's default directory can be cleared");
  }
  if (!request.file || !fs.existsSync(request.file)) return;
  const text = fs.readFileSync(request.file, "utf8");
  const header = JSON.parse(text.split("\n", 1)[0].trim()) as { type?: string; id?: string; cwd?: string };
  const expected = path.resolve(request.cwd);
  const actual = typeof header.cwd === "string" ? path.resolve(header.cwd) : "";
  if (header.type !== "session" || header.id !== request.sessionId
    || (process.platform === "win32" ? actual.toLowerCase() !== expected.toLowerCase() : actual !== expected)) {
    throw new Error(`Session file identity changed; preserved ${request.file}`);
  }
}

export function sessionClearStatus(dbManager: DatabaseManager, sessionId: string): "pending" | "cleared" | undefined {
  const row = dbManager.getDb().prepare("SELECT value FROM extension_metadata WHERE key = ?")
    .get(SESSION_CLEAR_PREFIX + sessionId) as { value: string } | undefined;
  if (!row) return undefined;
  return row.value === COMPLETE ? "cleared" : "pending";
}

export function isSessionCleared(dbManager: DatabaseManager, sessionId: string): boolean {
  return sessionClearStatus(dbManager, sessionId) !== undefined;
}

export function clearSessionHistory(dbManager: DatabaseManager, request: SessionClearRequest): void {
  const db = dbManager.getDb();
  if (!db.transaction) throw new Error("Session clearing requires database transactions");
  const key = SESSION_CLEAR_PREFIX + request.sessionId;
  // Persist exclusion and purge history atomically before deleting the source.
  // A failed file deletion remains pending and cannot be re-indexed or searched.
  db.transaction(() => {
    db.prepare("INSERT INTO extension_metadata (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(key, JSON.stringify({ status: "pending", file: request.file ?? null, cwd: request.cwd, historyMemoryDir: request.historyMemoryDir }));
    db.prepare("DELETE FROM messages WHERE session_id = ?").run(request.sessionId);
    db.prepare("DELETE FROM session_files WHERE session_id = ?").run(request.sessionId);
    db.prepare("DELETE FROM sessions WHERE id = ?").run(request.sessionId);
  })();
  // A missing role falls back to ordinary tools but its history keeps its original owner.
  if (request.historyMemoryDir && fs.existsSync(path.join(request.historyMemoryDir, "sessions.db"))) {
    const original = new DatabaseManager(request.historyMemoryDir);
    try { clearSessionHistory(original, { ...request, file: undefined, historyMemoryDir: undefined }); }
    finally { original.close(); }
  }
  validateSessionClear(request);
  if (request.file) {
    try { fs.unlinkSync(request.file); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  db.prepare("UPDATE extension_metadata SET value = ? WHERE key = ?").run(COMPLETE, key);
}

export function resumePendingSessionClears(dbManager: DatabaseManager): void {
  const rows = dbManager.getDb().prepare("SELECT key, value FROM extension_metadata WHERE substr(key, 1, ?) = ? AND value <> ?")
    .all(SESSION_CLEAR_PREFIX.length, SESSION_CLEAR_PREFIX, COMPLETE) as Array<{ key: string; value: string }>;
  for (const row of rows) {
    const pending = JSON.parse(row.value) as { status?: string; file?: unknown; cwd?: unknown; historyMemoryDir?: unknown };
    if (pending.status !== "pending" || typeof pending.cwd !== "string"
      || (pending.file !== null && typeof pending.file !== "string")
      || (pending.historyMemoryDir !== undefined && typeof pending.historyMemoryDir !== "string")) {
      throw new Error(`Invalid pending session clear: ${row.key}`);
    }
    clearSessionHistory(dbManager, {
      sessionId: row.key.slice(SESSION_CLEAR_PREFIX.length),
      file: typeof pending.file === "string" ? pending.file : undefined,
      cwd: pending.cwd,
      historyMemoryDir: typeof pending.historyMemoryDir === "string" ? pending.historyMemoryDir : undefined,
    });
  }
}
