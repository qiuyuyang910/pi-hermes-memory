import fs from 'node:fs/promises';
import path from 'node:path';
import type { MemoryAddition } from './memory-store.js';
import type { DatabaseManager } from './db.js';
import { failureProject, parseMarkdownMemoryEntry } from './sqlite-memory-store.js';
import { canonicalStoragePath } from './canonical-storage-path.js';
import { withMarkdownMutationLock } from './markdown-mutation-lock.js';

export function createMemoryAdditionLogger(
  memoryDir: string,
  dbManager: DatabaseManager,
  role: string | null,
  context: () => { sessionId: string | null; projectPath: string | null },
) {
  const logPath = path.join(memoryDir, 'logs', 'memory-additions.log');
  return async (addition: MemoryAddition, project: string | null = null, projectStore = false): Promise<string | null> => {
    try {
      const savedAt = new Date().toISOString();
      const owner = context();
      const databasePath = await canonicalStoragePath(path.join(memoryDir, 'sessions.db'));
      const records = addition.entries.map(entry => {
        const sqliteProject = addition.target === 'failure' ? failureProject(entry)
          : projectStore && addition.target === 'memory' ? project : null;
        const parsed = parseMarkdownMemoryEntry(entry, addition.target, sqliteProject);
        let entryId: number | null = null;
        let indexError = addition.indexWarning ?? null;
        if (!indexError) {
          try {
            const row = dbManager.getDb().prepare(`
              SELECT id FROM memories
              WHERE target = ? AND project IS ? AND category IS ? AND content = ?
              ORDER BY id ASC LIMIT 1
            `).get(parsed.target, parsed.project ?? null, parsed.category ?? null, parsed.content) as { id: number } | undefined;
            entryId = row ? Number(row.id) : null;
            if (!row) indexError = '未确认索引成功：SQLite 中没有对应条目';
          } catch (error) {
            indexError = `未确认索引成功：${error instanceof Error ? error.message : String(error)}`;
          }
        }
        return {
          savedAt, role, ...owner,
          project: parsed.project ?? null,
          target: projectStore && addition.target === 'memory' ? 'project' : addition.target,
          content: entry,
          markdownPath: addition.storagePath,
          markdownStatus: 'saved',
          sqlite: { databasePath, table: 'memories', entryId,
            status: entryId !== null && !indexError ? 'indexed' : 'unconfirmed', reason: indexError },
        };
      });
      await fs.mkdir(path.dirname(logPath), { recursive: true });
      const file = await canonicalStoragePath(logPath);
      // Share one lock across all stores and processes appending to this instance's log.
      await withMarkdownMutationLock(file, () => fs.appendFile(file, records.map(record => JSON.stringify(record)).join('\n') + '\n', 'utf8'));
      return null;
    } catch (error) {
      const warning = `记忆已保存，日志写入失败：${error instanceof Error ? error.message : String(error)}`;
      console.warn(warning);
      return warning;
    }
  };
}
