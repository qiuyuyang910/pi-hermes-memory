import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import type { ExtensionAPI, ExtensionContext, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { loadConfig } from "../vendor/hermes/src/config.js";
import type { MemoryConfig } from "../vendor/hermes/src/types.js";
import { createHermesRuntime, type HermesRuntime } from "./hermes-runtime.js";
import { loadRole, listRoles, type Role, type Thinking } from "./roles.js";
import { OWNER_ENTRY, canonical, scopeFor, ownerFor, ownerFromEntries, validateOwner,
  validateSessionLocation, ensureRoleStorage, recentSession, createEmptySession, type Owner } from "./storage.js";

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rolesDirectory = path.join(pluginRoot, "roles");
interface Selection { file: string; cwd: string; model?: string; thinking: Thinking; ordinaryTools: string[] }
const selectionFile = (file: string) => path.join(pluginRoot, ".state", "handoff", createHash("sha256").update(path.resolve(file)).digest("hex") + ".json");

function configFor(role: string | null): MemoryConfig {
  const config = loadConfig();
  return { ...config, lazyInitialization: false, reviewTransport: "direct",
    llmThinkingOverride: config.llmThinkingOverride ?? "off",
    ...(role ? { memoryDir: path.join(scopeFor(pluginRoot, role).agentRoot, "pi-hermes-memory"), projectsMemoryDir: "projects-memory" } : {}) };
}

function resolveModel(reference: string, ctx: ExtensionContext) {
  const model = ctx.modelRegistry.getAvailable().find(m => `${m.provider}/${m.id}` === reference);
  if (!model) throw new Error(`Model is unavailable or has no configured authentication: ${reference}`);
  return model;
}

export default function rolesHermes(pi: ExtensionAPI) {
  let runtime: HermesRuntime | undefined;
  let role: Role | undefined;
  let owner: Owner | undefined;
  let ordinaryTools: string[] = [];
  let allowedTools: Set<string> | undefined;
  let failure: string | undefined;
  let switching = false;
  const template = createHermesRuntime(pi, scopeFor(pluginRoot, null), configFor(null));
  const memoryTools = [...template.tools.keys()];

  function requireRuntime(): HermesRuntime {
    if (failure || !runtime) throw new Error(failure ?? "Hermes session has not initialized");
    return runtime;
  }
  function checkRoleTools(candidate: Role | undefined): void {
    const available = new Set(pi.getAllTools().map(t => t.name));
    for (const name of candidate?.tools ?? []) {
      if (!available.has(name)) throw new Error(`Role ${candidate?.id} names an unavailable tool: ${name}`);
    }
  }
  function applyTools(candidate: Role | undefined): void {
    const names = [...new Set([...(candidate?.tools ?? ordinaryTools), ...memoryTools])];
    allowedTools = candidate?.tools ? new Set(names) : undefined;
    pi.setActiveTools(names);
  }
  async function applyRole(candidate: Role | undefined, ctx: ExtensionContext, selection?: Selection): Promise<void> {
    checkRoleTools(candidate);
    const reference = candidate?.model ?? selection?.model;
    if (reference && !await pi.setModel(resolveModel(reference, ctx))) throw new Error(`Cannot select model: ${reference}`);
    const thinking = candidate?.thinking ?? selection?.thinking ?? pi.getThinkingLevel() ?? "low";
    pi.setThinkingLevel(thinking);
    applyTools(candidate);
  }

  for (const [name, tool] of template.tools) {
    pi.registerTool({ ...tool,
      execute: (...args) => requireRuntime().execute(name, ...args),
    });
  }
  for (const [name, command] of template.commands) {
    pi.registerCommand(name, { ...command, handler: (...args) => requireRuntime().command(name, ...args) });
  }

  pi.on("session_start", async (event, ctx) => {
    try {
      ordinaryTools = pi.getActiveTools();
      const savedTools = [...ctx.sessionManager.getEntries()].reverse().find(e => e.type === "custom" && e.customType === "roles-hermes-tools");
      if (savedTools?.type === "custom") {
        const saved = savedTools.data as { ordinaryTools?: unknown };
        if (Array.isArray(saved?.ordinaryTools) && saved.ordinaryTools.every(t => typeof t === "string")) ordinaryTools = saved.ordinaryTools;
      }
      const stored = ownerFromEntries(ctx.sessionManager.getEntries());
      const roleId = stored?.role ?? null;
      role = roleId ? loadRole(rolesDirectory, roleId) : undefined;
      owner = ownerFor(pluginRoot, ctx.cwd, roleId);
      if (stored) validateOwner(stored, owner);
      validateSessionLocation(ctx.sessionManager.getSessionFile(), owner);
      // Unlabelled files in role storage must never silently become ordinary sessions.
      const file = ctx.sessionManager.getSessionFile();
      const relative = file ? path.relative(path.join(pluginRoot, ".state", "roles"), path.resolve(file)) : undefined;
      if (!stored && relative !== undefined && relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative)) {
        throw new Error("Session in role storage is missing ownership metadata");
      }
      ensureRoleStorage(owner);
      let selection: Selection | undefined;
      if (file && fs.existsSync(selectionFile(file))) {
        selection = JSON.parse(fs.readFileSync(selectionFile(file), "utf8")) as Selection;
        if (selection.file !== path.resolve(file) || selection.cwd !== canonical(ctx.cwd)
          || !Array.isArray(selection.ordinaryTools) || !selection.ordinaryTools.every(t => typeof t === "string")
          || !["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(selection.thinking)) {
          throw new Error("Invalid role-switch handoff");
        }
        ordinaryTools = selection.ordinaryTools;
      }
      await applyRole(role, ctx, selection);
      runtime = createHermesRuntime(pi, scopeFor(pluginRoot, roleId), configFor(roleId));
      await runtime.dispatch("session_start", event, ctx);
      if (!stored) pi.appendEntry(OWNER_ENTRY, owner);
      if (selection && file) fs.unlinkSync(selectionFile(file));
      pi.appendEntry("roles-hermes-tools", { ordinaryTools });
      pi.appendEntry("roles-hermes-ready", true);
      pi.setSessionName(`${role?.name ?? "普通"} · ${path.basename(ctx.cwd)}`);
    } catch (error) {
      failure = `角色记忆初始化失败，已停止该会话的记忆操作：${error instanceof Error ? error.message : String(error)}`;
      await runtime?.close({ type: "session_shutdown", reason: "reload" }, ctx).catch(() => {});
      runtime = undefined;
      pi.appendEntry("roles-hermes-ready", false);
      ctx.ui.notify(failure, "error");
    }
  });

  for (const name of template.events.filter(e => !["session_start", "session_shutdown", "before_agent_start"].includes(e))) {
    const on = pi.on as (event: string, handler: (event: any, ctx: ExtensionContext) => any) => () => void;
    on(name, (event, ctx) => runtime && !failure ? runtime.dispatch(name, event, ctx) : undefined);
  }
  pi.on("before_agent_start", async (event, ctx) => {
    if (failure) throw new Error(failure);
    const result = await requireRuntime().dispatch("before_agent_start", event, ctx);
    if (role?.prompt) {
      const options = event.systemPromptOptions;
      if (options && "sections" in options) {
        options.appendSystemPrompt = [options.appendSystemPrompt, role.prompt].filter(Boolean).join("\n\n");
      } else {
        return { ...result, systemPrompt: (result?.systemPrompt ?? event.systemPrompt) + "\n\n" + role.prompt };
      }
    }
    return result;
  });
  pi.on("tool_call", async event => {
    if (failure || (allowedTools && !allowedTools.has(event.toolName))) {
      return { block: true, reason: failure ?? `当前角色未允许工具 ${event.toolName}` };
    }
  });
  pi.on("session_shutdown", async (event, ctx) => {
    try { await runtime?.close(event, ctx); } finally { runtime = undefined; }
  });

  pi.registerCommand("role", {
    description: "角色：list、current、<id> [--new]、off [--new]、reload",
    handler: async (args, ctx: ExtensionCommandContext) => {
      let pendingHandoff: string | undefined;
      try {
        const parts = args.trim().split(" ").filter(Boolean);
        const action = parts[0] ?? "current";
        if (parts.length > 2 || (parts[1] !== undefined && parts[1] !== "--new")
          || (["list", "current", "reload"].includes(action) && parts.length > 1)) {
          throw new Error("用法：/role <id|off> [--new]，或 /role list|current|reload");
        }
        if (action === "list") {
          ctx.ui.notify(listRoles(rolesDirectory).map(r => `${r.id} · ${r.name}${r.description ? `：${r.description}` : ""}`).join("\n") || "没有角色", "info");
          return;
        }
        if (action === "current") {
          const scope = scopeFor(pluginRoot, owner?.role ?? null);
          ctx.ui.notify(`${role?.name ?? "普通模式"}\n记忆：${configFor(owner?.role ?? null).memoryDir ?? path.join(scope.agentRoot, "pi-hermes-memory")}\n项目记忆：${path.join(scope.agentRoot, configFor(owner?.role ?? null).projectsMemoryDir ?? "projects-memory")}\n会话：${ctx.sessionManager.getSessionFile() ?? "未持久化"}${failure ? `\n${failure}` : ""}`, "info");
          return;
        }
        await ctx.waitForIdle();
        if (switching) throw new Error("角色切换正在进行");
        if (action === "reload") {
          if (!owner?.role) { ctx.ui.notify("当前是普通模式", "info"); return; }
          const candidate = loadRole(rolesDirectory, owner.role);
          await applyRole(candidate, ctx);
          role = candidate;
          ctx.ui.notify(`已重读角色 ${candidate.id}`, "info");
          return;
        }
        const targetRole = action === "off" ? null : action;
        const candidate = targetRole ? loadRole(rolesDirectory, targetRole) : undefined;
        checkRoleTools(candidate);
        if (candidate?.model) resolveModel(candidate.model, ctx);
        const inheritedModel = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined;
        if (inheritedModel) resolveModel(inheritedModel, ctx);
        const targetOwner = ownerFor(pluginRoot, ctx.cwd, targetRole);
        ensureRoleStorage(targetOwner);
        let file = parts[1] === "--new" ? undefined : await recentSession(pluginRoot, ctx.cwd, targetRole);
        const created = !file;
        file ??= createEmptySession(pluginRoot, ctx.cwd, targetRole);
        const selection: Selection = { file: path.resolve(file), cwd: canonical(ctx.cwd),
          model: inheritedModel,
          thinking: pi.getThinkingLevel() ?? "low", ordinaryTools: role ? ordinaryTools : pi.getActiveTools() };
        const handoff = selectionFile(file);
        fs.mkdirSync(path.dirname(handoff), { recursive: true });
        fs.writeFileSync(handoff, JSON.stringify(selection), { encoding: "utf8", flag: "wx" });
        pendingHandoff = handoff;
        switching = true;
        // Pi creates a new extension API and ctx. All setup runs in its session_start.
        // Never call the outgoing pi or ctx after an accepted replacement.
        const result = await ctx.switchSession(file, { withSession: async fresh => {
          const status = [...fresh.sessionManager.getEntries()].reverse().find(e => e.type === "custom" && e.customType === "roles-hermes-ready");
          if (status?.type === "custom" && status.data === true) {
            fresh.ui.notify(`已进入 ${candidate?.name ?? "普通模式"}`, "info");
          } else {
            fresh.ui.notify("目标会话初始化失败，记忆写入已停止。使用 /role off 恢复普通模式。", "error");
          }
        } });
        if (result.cancelled) {
          switching = false;
          fs.unlinkSync(handoff);
          if (created) fs.unlinkSync(file);
          ctx.ui.notify("角色切换已取消，保留当前模式", "info");
        } else if (fs.existsSync(handoff)) {
          fs.unlinkSync(handoff);
        }
      } catch (error) {
        switching = false;
        if (pendingHandoff && fs.existsSync(pendingHandoff)) fs.unlinkSync(pendingHandoff);
        // If Pi itself failed to construct a replacement, its old context may
        // already be invalid. Do not reopen storage with that context.
        try { ctx.ui.notify(error instanceof Error ? error.message : String(error), "error"); }
        catch { console.error(error); }
      }
    },
  });
}
