import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

// Load only the native session manager; the SDK barrel also loads unrelated UI extensions.
const { SessionManager } = await import(new URL('./core/session-manager.js', import.meta.resolve('@earendil-works/pi-coding-agent')).href);

// Offline only: stop Pi before invoking this script. No memory or Skills are changed.
const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rolesRoot = path.join(pluginRoot, '.state', 'roles');
const configuredRoot = process.env.PI_CODING_AGENT_DIR?.trim();
const expandHome = value => value === '~' ? os.homedir()
  : value.startsWith('~/') || value.startsWith('~\\') ? path.join(os.homedir(), value.slice(2)) : value;
const agentRoot = configuredRoot ? path.resolve(expandHome(configuredRoot)) : path.join(os.homedir(), '.pi', 'agent');
const destinationRoot = path.join(agentRoot, 'sessions');
const journalFile = path.join(pluginRoot, '.state', 'session-migration.json');
const canonical = value => {
  const resolved = fs.realpathSync.native(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
};
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
function inside(root, file) {
  const relative = path.relative(path.resolve(root), path.resolve(file));
  return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}
function listFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  const result = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error(`Refusing redirected source: ${path.join(directory, entry.name)}`);
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...listFiles(file));
    else if (entry.isFile() && entry.name.endsWith('.jsonl')) result.push(file);
  }
  return result;
}
function saveJournal(tasks) {
  const temporary = journalFile + '.tmp';
  fs.writeFileSync(temporary, JSON.stringify(tasks, null, 2) + '\n', 'utf8');
  fs.renameSync(temporary, journalFile);
}
function updateHistory(task) {
  const databaseFile = path.join(rolesRoot, task.role, 'pi-hermes-memory', 'sessions.db');
  if (!fs.existsSync(databaseFile)) return;
  const database = new Database(databaseFile, { fileMustExist: true });
  try {
    database.transaction(() => {
      const targetRow = database.prepare('SELECT session_id FROM session_files WHERE path = ?').get(task.target);
      const sourceRow = database.prepare('SELECT session_id FROM session_files WHERE path = ?').get(task.source);
      if ((targetRow && targetRow.session_id !== task.id) || (sourceRow && sourceRow.session_id !== task.id))
        throw new Error(`History index conflict: ${task.source}`);
      if (targetRow) database.prepare('DELETE FROM session_files WHERE path = ?').run(task.source);
      else database.prepare('UPDATE session_files SET path = ? WHERE path = ?').run(task.target, task.source);
      const pending = database.prepare("SELECT key, value FROM extension_metadata WHERE substr(key, 1, ?) = ?")
        .all('roles-hermes:cleared-session:'.length, 'roles-hermes:cleared-session:');
      for (const row of pending) {
        const value = JSON.parse(row.value);
        if (value.file === task.source) {
          value.file = task.target;
          database.prepare('UPDATE extension_metadata SET value = ? WHERE key = ?').run(JSON.stringify(value), row.key);
        }
      }
    })();
  } finally { database.close(); }
}

try {
  if (process.argv.length > 2) throw new Error('Usage: node scripts/migrate-role-sessions.mjs (close Pi first)');
  if (!fs.existsSync(rolesRoot)) {
    console.log('No legacy role sessions to migrate.');
  } else {
    if (canonical(rolesRoot) !== (process.platform === 'win32' ? rolesRoot.toLowerCase() : rolesRoot))
      throw new Error('Legacy role storage redirects to another location');
    const tasks = fs.existsSync(journalFile) ? JSON.parse(fs.readFileSync(journalFile, 'utf8')) : [];
    if (!Array.isArray(tasks)) throw new Error('Invalid migration journal');
    for (const entry of fs.readdirSync(rolesRoot, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error(`Refusing redirected role: ${entry.name}`);
      if (!entry.isDirectory()) continue;
      const roleRoot = path.join(rolesRoot, entry.name);
      for (const source of listFiles(path.join(roleRoot, 'sessions'))) {
        if (tasks.some(task => task.source === source)) continue;
        const bytes = fs.readFileSync(source);
        const entries = bytes.toString('utf8').split('\n').filter(line => line.trim()).map(line => JSON.parse(line));
        const header = entries[0];
        const owner = [...entries].reverse().find(item => item.type === 'custom' && item.customType === 'roles-hermes-owner')?.data;
        if (header?.type !== 'session' || typeof header.id !== 'string' || typeof header.cwd !== 'string'
          || !owner || owner.role !== entry.name || canonical(owner.root) !== canonical(roleRoot)
          || canonical(owner.cwd) !== canonical(header.cwd) || owner.project !== digest(canonical(header.cwd)))
          throw new Error(`Invalid legacy ownership: ${source}`);
        // Use Pi's own project-directory convention without persisting a dummy session.
        const target = path.join(SessionManager.create(header.cwd).getSessionDir(), path.basename(source));
        const stat = fs.statSync(source);
        tasks.push({ source, target, role: entry.name, id: header.id, hash: digest(bytes),
          atimeMs: stat.atimeMs, mtimeMs: stat.mtimeMs, complete: false });
      }
    }
    // Preflight every path and collision before copying any session.
    const destinations = new Map();
    for (const task of tasks) {
      if (typeof task.role !== 'string' || !inside(rolesRoot, task.source)
        || !inside(path.join(rolesRoot, task.role, 'sessions'), task.source)
        || !inside(destinationRoot, task.target) || !inside(rolesRoot, path.join(rolesRoot, task.role)))
        throw new Error('Migration journal contains an out-of-scope path');
      if (destinations.has(task.target) && destinations.get(task.target) !== task.hash)
        throw new Error(`Multiple sources conflict at destination: ${task.target}`);
      destinations.set(task.target, task.hash);
      if (fs.existsSync(task.source) && digest(fs.readFileSync(task.source)) !== task.hash)
        throw new Error(`Source changed: ${task.source}`);
      if (fs.existsSync(task.target) && digest(fs.readFileSync(task.target)) !== task.hash)
        throw new Error(`Destination conflict: ${task.target}`);
      if (!fs.existsSync(task.source) && !fs.existsSync(task.target)) throw new Error(`Missing migration source and target: ${task.source}`);
    }
    saveJournal(tasks);
    for (const task of tasks) {
      if (task.complete && !fs.existsSync(task.source)) continue;
      fs.mkdirSync(path.dirname(task.target), { recursive: true });
      if (!inside(canonical(destinationRoot), canonical(path.dirname(task.target)))) throw new Error('Destination redirects outside session storage');
      if (!fs.existsSync(task.target)) {
        const temporary = task.target + '.roles-hermes-migration';
        if (fs.existsSync(temporary) && (!fs.lstatSync(temporary).isFile() || fs.lstatSync(temporary).isSymbolicLink()))
          throw new Error(`Unsafe temporary copy: ${temporary}`);
        fs.copyFileSync(task.source, temporary);
        fs.utimesSync(temporary, task.atimeMs / 1000, task.mtimeMs / 1000);
        if (digest(fs.readFileSync(temporary)) !== task.hash) throw new Error(`Copy verification failed: ${temporary}`);
        // Publish a complete copy without overwriting a destination created meanwhile.
        fs.linkSync(temporary, task.target);
        fs.unlinkSync(temporary);
      }
      if (digest(fs.readFileSync(task.target)) !== task.hash) throw new Error(`Copy verification failed: ${task.target}`);
      updateHistory(task);
      if (fs.existsSync(task.source)) {
        if (digest(fs.readFileSync(task.source)) !== task.hash || !inside(canonical(rolesRoot), canonical(task.source)))
          throw new Error(`Source changed before removal: ${task.source}`);
        fs.unlinkSync(task.source);
      }
      task.complete = true;
      saveJournal(tasks);
      console.log(`Migrated ${task.role}: ${task.id}`);
    }
    console.log(`Migration complete. Journal: ${journalFile}`);
  }
} catch (error) {
  console.error(`Migration stopped; retained copies and journal allow retry: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
