import * as fs from "node:fs";
import * as path from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { AGENT_ROOT } from "../vendor/hermes/src/paths.js";
import type { HermesScope } from "../vendor/hermes/src/runtime-scope.js";
import { OWNER_ENTRY, canonical, projectId, parseOwner, type Owner } from "../vendor/hermes/src/store/session-ownership.js";

export { OWNER_ENTRY, canonical, projectId, type Owner } from "../vendor/hermes/src/store/session-ownership.js";

export function scopeFor(pluginRoot: string, role: string | null): HermesScope {
  const agentRoot = role ? path.join(pluginRoot, ".state", "roles", role) : AGENT_ROOT;
  return { agentRoot, sessionsDir: path.join(AGENT_ROOT, "sessions"), isolated: role !== null, role };
}
export function ownerFor(pluginRoot: string, cwd: string, role: string | null): Owner {
  return { role, project: projectId(cwd), cwd: canonical(cwd), root: path.resolve(scopeFor(pluginRoot, role).agentRoot) };
}
export function ownerFromEntries(entries: ReturnType<ExtensionContext["sessionManager"]["getEntries"]>): Owner | undefined {
  const entry = [...entries].reverse().find(e => e.type === "custom" && e.customType === OWNER_ENTRY);
  if (entry?.type !== "custom") return undefined;
  const data = parseOwner(entry.data);
  if (!data) throw new Error("Invalid session ownership metadata");
  return data;
}
export function validateOwner(owner: Owner, expected: Owner): void {
  if (owner.role !== expected.role || owner.project !== expected.project || owner.cwd !== expected.cwd
    || path.resolve(owner.root) !== expected.root) throw new Error("Session ownership does not match its role, project or storage root");
}
export function validateSessionLocation(file: string | undefined, _owner: Owner): void {
  if (!file) return;
  const relative = path.relative(path.toNamespacedPath(path.join(AGENT_ROOT, "sessions")), path.toNamespacedPath(path.resolve(file)));
  if (relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative))
    throw new Error("Session is outside Pi's default session directory; migrate legacy role sessions first");
}
export function ensureRoleStorage(owner: Owner): void {
  if (!owner.role) return;
  for (const dir of [owner.root, path.join(owner.root, "pi-hermes-memory"), path.join(owner.root, "projects-memory")]) {
    fs.mkdirSync(dir, { recursive: true });
    const resolved = path.resolve(dir);
    const expected = process.platform === "win32" ? resolved.toLowerCase() : resolved;
    if (canonical(dir) !== expected) throw new Error(`Role storage redirects to another location: ${dir}`);
  }
}
export function createEmptySession(pluginRoot: string, cwd: string, role: string | null): string {
  const owner = ownerFor(pluginRoot, cwd, role);
  ensureRoleStorage(owner);
  const manager = SessionManager.create(cwd);
  manager.appendCustomEntry(OWNER_ENTRY, owner);
  const file = manager.getSessionFile();
  if (!file) throw new Error("A persistent session file is required");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // Pi defers flushing a newly created session until its first assistant message.
  // Materialize this empty native session so switchSession can open it immediately.
  fs.writeFileSync(file, [manager.getHeader(), ...manager.getEntries()].map(e => JSON.stringify(e)).join("\n") + "\n", { encoding: "utf8", flag: "wx" });
  return file;
}
