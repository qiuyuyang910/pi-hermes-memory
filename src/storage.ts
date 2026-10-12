import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { AGENT_ROOT } from "../vendor/hermes/src/paths.js";
import type { HermesScope } from "../vendor/hermes/src/runtime-scope.js";

export const OWNER_ENTRY = "roles-hermes-owner";
export function canonical(file: string): string {
  const resolved = fs.realpathSync.native(file);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}
export function projectId(cwd: string): string {
  return createHash("sha256").update(canonical(cwd)).digest("hex");
}
export interface Owner { role: string | null; project: string; cwd: string; root: string }

export function scopeFor(pluginRoot: string, role: string | null): HermesScope {
  const agentRoot = role ? path.join(pluginRoot, ".state", "roles", role) : AGENT_ROOT;
  return { agentRoot, sessionsDir: path.join(agentRoot, "sessions"), isolated: role !== null };
}
export function ownerFor(pluginRoot: string, cwd: string, role: string | null): Owner {
  return { role, project: projectId(cwd), cwd: canonical(cwd), root: path.resolve(scopeFor(pluginRoot, role).agentRoot) };
}
export function ownerFromEntries(entries: ReturnType<ExtensionContext["sessionManager"]["getEntries"]>): Owner | undefined {
  const entry = [...entries].reverse().find(e => e.type === "custom" && e.customType === OWNER_ENTRY);
  return entry?.type === "custom" ? entry.data as Owner : undefined;
}
export function validateOwner(owner: Owner, expected: Owner): void {
  if (owner.role !== expected.role || owner.project !== expected.project || owner.cwd !== expected.cwd
    || path.resolve(owner.root) !== expected.root) throw new Error("Session ownership does not match its role, project or storage root");
}
export function validateSessionLocation(file: string | undefined, owner: Owner): void {
  if (!owner.role) return;
  if (!file || path.dirname(path.resolve(file)) !== path.join(owner.root, "sessions", owner.project)) {
    throw new Error("Role session is outside its assigned session directory");
  }
}
export function ensureRoleStorage(owner: Owner): void {
  if (!owner.role) return;
  for (const dir of [owner.root, path.join(owner.root, "pi-hermes-memory"), path.join(owner.root, "projects-memory"), path.join(owner.root, "sessions", owner.project)]) {
    fs.mkdirSync(dir, { recursive: true });
    const resolved = path.resolve(dir);
    const expected = process.platform === "win32" ? resolved.toLowerCase() : resolved;
    if (canonical(dir) !== expected) throw new Error(`Role storage redirects to another location: ${dir}`);
  }
}
export async function recentSession(pluginRoot: string, cwd: string, role: string | null): Promise<string | undefined> {
  const owner = ownerFor(pluginRoot, cwd, role);
  const directory = role ? path.join(owner.root, "sessions", owner.project) : undefined;
  const sessions = await SessionManager.list(cwd, directory);
  for (const session of sessions) {
    const manager = SessionManager.open(session.path);
    const stored = ownerFromEntries(manager.getEntries());
    if (!stored && !role) return session.path;
    if (!stored || stored.role !== role) continue;
    validateOwner(stored, owner);
    validateSessionLocation(session.path, owner);
    return session.path;
  }
  return undefined;
}
export function createEmptySession(pluginRoot: string, cwd: string, role: string | null): string {
  const owner = ownerFor(pluginRoot, cwd, role);
  ensureRoleStorage(owner);
  const manager = SessionManager.create(cwd, role ? path.join(owner.root, "sessions", owner.project) : undefined);
  manager.appendCustomEntry(OWNER_ENTRY, owner);
  const file = manager.getSessionFile();
  if (!file) throw new Error("A persistent session file is required");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // Pi defers flushing a newly created session until its first assistant message.
  // Materialize this empty native session so switchSession can open it immediately.
  fs.writeFileSync(file, [manager.getHeader(), ...manager.getEntries()].map(e => JSON.stringify(e)).join("\n") + "\n", { encoding: "utf8", flag: "wx" });
  return file;
}
