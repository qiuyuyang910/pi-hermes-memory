import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { hermesScope } from '../runtime-scope.js';
import type { DatabaseManager } from './db.js';

export const OWNER_ENTRY = 'roles-hermes-owner';
export interface Owner { role: string | null; project: string; cwd: string; root: string }

export function canonical(file: string): string {
  const resolved = fs.realpathSync.native(file);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

export function projectId(cwd: string): string {
  return createHash('sha256').update(canonical(cwd)).digest('hex');
}

export function parseOwner(data: unknown): Owner | undefined {
  const owner = data as Owner | undefined;
  if (!owner || (owner.role !== null && typeof owner.role !== 'string')
    || typeof owner.cwd !== 'string' || typeof owner.root !== 'string' || typeof owner.project !== 'string') return undefined;
  return owner;
}

export function sessionBelongsToScope(entries: unknown[], cwd: string): boolean {
  const scope = hermesScope.getStore();
  if (!scope) return true;
  const entry = [...entries].reverse().find(value => value && typeof value === 'object'
    && (value as any).type === 'custom' && (value as any).customType === OWNER_ENTRY) as any;
  if (!entry) return scope.role === null;
  const owner = parseOwner(entry.data);
  if (!owner) {
    console.warn('Skipped session with invalid roles-hermes-owner metadata');
    return false;
  }
  try {
    return owner && owner.role === scope.role && typeof owner.cwd === 'string'
      && canonical(owner.cwd) === canonical(cwd)
      && owner.project === projectId(cwd)
      && typeof owner.root === 'string' && canonical(owner.root) === canonical(scope.agentRoot);
  } catch { return false; }
}

export function sessionFileBelongsToScope(file: string, expectedId?: string): boolean {
  const scope = hermesScope.getStore();
  if (!scope) return true;
  const relative = path.relative(path.toNamespacedPath(scope.sessionsDir), path.toNamespacedPath(path.resolve(file)));
  if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) return false;
  try {
    const entries = fs.readFileSync(file, 'utf8').split('\n').filter(line => line.trim()).map(line => JSON.parse(line));
    const header = entries[0];
    return header?.type === 'session' && typeof header.cwd === 'string'
      && (!expectedId || header.id === expectedId) && sessionBelongsToScope(entries, header.cwd);
  } catch (error) {
    console.warn(`Skipped invalid or unavailable session ${file}: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

// Revalidate source ownership before SQL limits are applied, including old indexes.
export function pruneForeignSessionHistory(dbManager: DatabaseManager): void {
  if (!hermesScope.getStore()) return;
  const db = dbManager.getDb();
  const rows = db.prepare('SELECT s.id, sf.path FROM sessions s LEFT JOIN session_files sf ON sf.session_id = s.id')
    .all() as Array<{ id: string; path: string | null }>;
  const allowed = new Set(rows.filter(row => row.path && sessionFileBelongsToScope(row.path, row.id)).map(row => row.id));
  const rejected = [...new Set(rows.map(row => row.id))].filter(id => !allowed.has(id));
  if (!rejected.length) return;
  if (!db.transaction) throw new Error('History ownership cleanup requires transactions');
  db.transaction(() => {
    for (const id of rejected) {
      db.prepare('DELETE FROM messages WHERE session_id = ?').run(id);
      db.prepare('DELETE FROM session_files WHERE session_id = ?').run(id);
      db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
    }
  })();
}
