import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { loadConfig } from "../vendor/hermes/src/config.js";
import type { MemoryConfig } from "../vendor/hermes/src/types.js";
import type { SessionClearTask } from "../vendor/hermes/src/store/session-clear.js";
import { createHermesRuntime, type HermesRuntime } from "./hermes-runtime.js";
import { loadRole, validRoleId, type Role } from "./roles.js";
import { OWNER_ENTRY, canonical, scopeFor, ownerFor, ownerFromEntries, validateOwner,
  validateSessionLocation, ensureRoleStorage, createEmptySession, type Owner } from "./storage.js";
import { createRoleHandoff, type Selection } from "./role-handoff.js";
import { REQUEST_ENTRY, requestLockReason } from "./request-state.js";

function configFor(pluginRoot: string, role: string | null): MemoryConfig {
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

export function createRoleSession(pi: ExtensionAPI, pluginRoot: string) {
  const rolesDirectory = path.join(pluginRoot, "roles");
  const handoffs = createRoleHandoff(pluginRoot);
  let runtime: HermesRuntime | undefined;
  let role: Role | undefined;
  let owner: Owner | undefined;
  let ordinaryTools: string[] = [];
  let allowedTools: Set<string> | undefined;
  let failure: string | undefined;
  let switching = false;
  let requestLocked = false;
  let suppressPrompt = true;
  let missingRole = false;
  const template = createHermesRuntime(pi, scopeFor(pluginRoot, null), configFor(pluginRoot, null));
  const memoryTools = [...template.tools.keys()];

  function requireRuntime(): HermesRuntime {
    if (switching) throw new Error("角色切换正在进行");
    if (failure || !runtime) throw new Error(failure ?? "Hermes session has not initialized");
    return runtime;
  }
  function checkRoleTools(candidate: Role | undefined): void {
    if (candidate?.tools?.includes("*")) return;
    const available = new Set(pi.getAllTools().map(t => t.name));
    for (const name of candidate?.tools ?? []) {
      if (!available.has(name)) throw new Error(`Role ${candidate?.id} names an unavailable tool: ${name}`);
    }
  }
  function applyTools(candidate: Role | undefined): void {
    const allTools = candidate?.tools?.includes("*") === true;
    const businessTools = allTools ? pi.getAllTools().map(t => t.name) : candidate?.tools ?? ordinaryTools;
    const names = [...new Set([...businessTools, ...memoryTools])];
    allowedTools = candidate?.tools && !allTools ? new Set(names) : undefined;
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

  function beforeProviderRequest(_event: any, ctx: ExtensionContext) {
    if (switching || failure) throw new Error(failure ?? "角色切换正在进行，不能发送模型请求");
    if (!requestLocked) {
      requestLocked = true;
      pi.appendEntry(REQUEST_ENTRY, { status: "locked" });
    }
  }

  async function start(event: any, ctx: ExtensionContext) {
    let newSession = false;
    let selection: Selection | undefined;
    try {
      ordinaryTools = pi.getActiveTools();
      const savedTools = [...ctx.sessionManager.getEntries()].reverse().find(e => e.type === "custom" && e.customType === "roles-hermes-tools");
      if (savedTools?.type === "custom") {
        const saved = savedTools.data as { ordinaryTools?: unknown };
        if (Array.isArray(saved?.ordinaryTools) && saved.ordinaryTools.every(t => typeof t === "string")) ordinaryTools = saved.ordinaryTools;
      }
      const stored = ownerFromEntries(ctx.sessionManager.getEntries());
      const roleId = stored?.role ?? null;
      if (roleId !== null && (typeof roleId !== "string" || !validRoleId(roleId))) throw new Error("Invalid stored role identifier");
      missingRole = roleId !== null && !fs.existsSync(path.join(rolesDirectory, `${roleId}.md`));
      role = roleId && !missingRole ? loadRole(rolesDirectory, roleId) : undefined;
      if (stored) validateOwner(stored, ownerFor(pluginRoot, ctx.cwd, roleId));
      owner = ownerFor(pluginRoot, ctx.cwd, missingRole ? null : roleId);
      validateSessionLocation(ctx.sessionManager.getSessionFile(), owner);
      // Unlabelled files in role storage must never silently become ordinary sessions.
      const file = ctx.sessionManager.getSessionFile();
      const relative = file ? path.relative(path.toNamespacedPath(path.join(pluginRoot, ".state", "roles")), path.toNamespacedPath(path.resolve(file))) : undefined;
      if (!stored && relative !== undefined && relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative)) {
        throw new Error("Session in role storage is missing ownership metadata");
      }
      ensureRoleStorage(owner);
      selection = file ? handoffs.read(file, ctx.cwd) : undefined;
      if (selection) ordinaryTools = selection.ordinaryTools;
      const entries = ctx.sessionManager.getEntries();
      newSession = Boolean(selection) || event.reason === "new"
        || (event.reason === "startup" && (!file || !fs.existsSync(file))
          && entries.every(e => ["model_change", "thinking_level_change"].includes(e.type)));
      requestLocked = false;
      requestLocked = Boolean(requestLockReason(ctx, requestLocked));
      newSession = newSession && !requestLocked;
      if (!entries.some(e => e.type === "custom" && e.customType === REQUEST_ENTRY)) {
        pi.appendEntry(REQUEST_ENTRY, { status: requestLocked ? "locked" : "unrequested" });
      }
      suppressPrompt = missingRole;
      if (newSession) await applyRole(role, ctx, selection);
      else {
        checkRoleTools(role);
        if (role?.model) resolveModel(role.model, ctx);
        applyTools(role);
      }
      const effectiveRole = missingRole ? null : roleId;
      const scope = { ...scopeFor(pluginRoot, effectiveRole), suppressAutomation: missingRole };
      const config = configFor(pluginRoot, effectiveRole);
      if (missingRole) config.flushOnShutdown = false;
      runtime = createHermesRuntime(pi, scope, config);
      await runtime.dispatch("session_start", event, ctx);
      if (selection?.clearSessionId) {
        pi.appendEntry("roles-hermes-clear-result", {
          sessionId: selection.clearSessionId,
          cleared: await runtime.clearStatus(selection.clearSessionId) === "cleared",
        });
      }
      if (!stored && newSession) pi.appendEntry(OWNER_ENTRY, owner);
      if (selection && file) handoffs.remove(handoffs.pathFor(file));
      if (newSession) {
        pi.appendEntry("roles-hermes-tools", { ordinaryTools });
        pi.appendEntry("roles-hermes-ready", true);
        pi.setSessionName(`${role?.name ?? "普通"} · ${path.basename(ctx.cwd)}`);
      }
      if (missingRole) ctx.ui.notify(`角色 ${roleId} 不存在，已进入普通模式；保留原上下文和归属，本会话不注入提示或自动保存记忆。`, "warning");
    } catch (error) {
      if (selection?.rollback) {
        const previous = selection.rollback;
        try {
          await runtime?.close({ type: "session_shutdown", reason: "reload" }, ctx, { skipFlush: true });
          runtime = undefined;
          validateOwner(previous.owner, ownerFor(pluginRoot, ctx.cwd, previous.owner.role));
          validateOwner(previous.storedOwner, ownerFor(pluginRoot, ctx.cwd, previous.storedOwner.role));
          role = previous.role;
          owner = previous.owner;
          ordinaryTools = previous.ordinaryTools;
          missingRole = previous.missingRole;
          suppressPrompt = previous.suppressPrompt;
          pi.appendEntry(OWNER_ENTRY, previous.storedOwner);
          pi.appendEntry("roles-hermes-tools", { ordinaryTools });
          pi.setSessionName(previous.name ?? "");
          if (previous.model && !await pi.setModel(resolveModel(previous.model, ctx))) throw new Error("无法恢复原模型");
          pi.setThinkingLevel(previous.thinking);
          applyTools(role);
          pi.setActiveTools(previous.tools);
          const config = configFor(pluginRoot, owner.role);
          if (missingRole) config.flushOnShutdown = false;
          runtime = createHermesRuntime(pi, { ...scopeFor(pluginRoot, owner.role), suppressAutomation: missingRole }, config);
          await runtime.dispatch("session_start", event, ctx);
          const file = ctx.sessionManager.getSessionFile();
          if (file) handoffs.removeIfPresent(handoffs.pathFor(file));
          ctx.ui.notify(`目标初始化失败，已恢复原模式：${error instanceof Error ? error.message : String(error)}`, "error");
          return;
        } catch (restoreError) {
          error = new Error(`${error instanceof Error ? error.message : String(error)}；原模式恢复失败：${restoreError instanceof Error ? restoreError.message : String(restoreError)}`);
        }
      }
      failure = `角色记忆初始化失败，已停止该会话的记忆操作：${error instanceof Error ? error.message : String(error)}`;
      await runtime?.close({ type: "session_shutdown", reason: "reload" }, ctx).catch(() => {});
      runtime = undefined;
      if (newSession) pi.appendEntry("roles-hermes-ready", false);
      ctx.ui.notify(failure, "error");
    }
  }

  async function beforeAgentStart(event: any, ctx: ExtensionContext) {
    if (switching) throw new Error("角色切换正在进行");
    if (failure) throw new Error(failure);
    if (suppressPrompt) return;
    if (role?.prompt) {
      const options = event.systemPromptOptions;
      if (options && "sections" in options) {
        options.appendSystemPrompt = [options.appendSystemPrompt, role.prompt].filter(Boolean).join("\n\n");
      } else {
        const systemPrompt = event.systemPrompt + "\n\n" + role.prompt;
        const result = await requireRuntime().dispatch("before_agent_start", { ...event, systemPrompt }, ctx);
        return { ...result, systemPrompt: result?.systemPrompt ?? systemPrompt };
      }
    }
    return requireRuntime().dispatch("before_agent_start", event, ctx);
  }

  async function toolCall(event: { toolName: string }) {
    if (switching || failure || (allowedTools && !allowedTools.has(event.toolName))) {
      return { block: true, reason: failure ?? (switching ? "角色切换正在进行" : `当前角色未允许工具 ${event.toolName}`) };
    }
  }
  async function shutdown(event: any, ctx: ExtensionContext) {
    try { await runtime?.close(event, ctx); } finally { runtime = undefined; }
  }

  async function changeRole(action: string, ctx: ExtensionCommandContext) {
    let pendingHandoff: string | undefined;
    let clearingRuntime: HermesRuntime | undefined;
    let clearTask: SessionClearTask | undefined;
    try {
      await ctx.waitForIdle();
      if (switching) throw new Error("角色切换正在进行");
      const lockReason = requestLockReason(ctx, requestLocked);
      if (action !== "clear" && lockReason) throw new Error(`${lockReason}。请使用 Pi 新建会话后选择角色。`);
      if (action === "reload" && !owner?.role) { ctx.ui.notify("当前是普通模式", "info"); return; }
      const clearing = action === "clear";
      if (clearing) clearingRuntime = requireRuntime();
      const targetRole = clearing || action === "reload" ? owner?.role ?? null : action === "off" ? null : action;
      const candidate = targetRole ? loadRole(rolesDirectory, targetRole) : undefined;
      checkRoleTools(candidate);
      if (candidate?.model) resolveModel(candidate.model, ctx);
      const inheritedModel = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined;
      if (inheritedModel) resolveModel(inheritedModel, ctx);
      const targetOwner = ownerFor(pluginRoot, ctx.cwd, targetRole);
      ensureRoleStorage(targetOwner);
      if (!clearing) {
        const outgoing = requireRuntime();
        const sessionFile = ctx.sessionManager.getSessionFile();
        if (!sessionFile) throw new Error("角色切换需要可持久化的 Pi 会话");
        const previous = { role, owner, ordinaryTools, allowedTools, suppressPrompt, missingRole,
          tools: pi.getActiveTools(), model: ctx.model, thinking: pi.getThinkingLevel(),
          name: ctx.sessionManager.getSessionName(), storedOwner: ownerFromEntries(ctx.sessionManager.getEntries()) };
        let targetRuntime: HermesRuntime | undefined;
        let ownershipChanged = false;
        let refreshing = false;
        switching = true;
        try {
          await outgoing.close({ type: "session_shutdown", reason: "reload" }, ctx, { skipFlush: true });
          runtime = undefined;
          targetRuntime = createHermesRuntime(pi, scopeFor(pluginRoot, targetRole), configFor(pluginRoot, targetRole));
          await targetRuntime.dispatch("session_start", { type: "session_start", reason: "reload" }, ctx);
          ordinaryTools = previous.role ? previous.ordinaryTools : previous.tools;
          await applyRole(candidate, ctx);
          ownershipChanged = true;
          pi.appendEntry(OWNER_ENTRY, targetOwner);
          pi.appendEntry("roles-hermes-tools", { ordinaryTools });
          pi.setSessionName(`${candidate?.name ?? "普通"} · ${path.basename(ctx.cwd)}`);
          role = candidate;
          owner = targetOwner;
          missingRole = false;
          suppressPrompt = false;
          runtime = targetRuntime;
          ctx.ui.notify(action === "reload" ? `已重读角色 ${candidate?.id}` : `已进入 ${candidate?.name ?? "普通模式"}`, "info");
          // Refresh Pi's skill catalog in this same session; the new extension owns setup and rollback.
          const handoff = handoffs.write({ file: path.resolve(sessionFile), cwd: canonical(ctx.cwd),
            model: ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined,
            thinking: pi.getThinkingLevel(), ordinaryTools,
            rollback: { role: previous.role, owner: previous.owner ?? ownerFor(pluginRoot, ctx.cwd, null),
              storedOwner: previous.storedOwner ?? ownerFor(pluginRoot, ctx.cwd, previous.owner?.role ?? null),
              ordinaryTools: previous.ordinaryTools, tools: previous.tools,
              model: previous.model ? `${previous.model.provider}/${previous.model.id}` : undefined,
              thinking: previous.thinking, suppressPrompt: previous.suppressPrompt,
              missingRole: previous.missingRole, name: previous.name },
          } satisfies Selection);
          pendingHandoff = handoff;
          await targetRuntime.close({ type: "session_shutdown", reason: "reload" }, ctx, { skipFlush: true });
          runtime = undefined;
          refreshing = true;
          await ctx.reload();
        } catch (error) {
          if (refreshing) {
            console.error(`Pi 资源重载失败，请重新打开会话；恢复信息保留在交接记录中：${error instanceof Error ? error.message : String(error)}`);
            return;
          }
          await targetRuntime?.close({ type: "session_shutdown", reason: "reload" }, ctx, { skipFlush: true }).catch(() => {});
          runtime = undefined;
          role = previous.role;
          owner = previous.owner;
          ordinaryTools = previous.ordinaryTools;
          allowedTools = previous.allowedTools;
          suppressPrompt = previous.suppressPrompt;
          missingRole = previous.missingRole;
          try {
            if (ownershipChanged) {
              pi.appendEntry(OWNER_ENTRY, previous.storedOwner ?? ownerFor(pluginRoot, ctx.cwd, previous.owner?.role ?? null));
              pi.appendEntry("roles-hermes-tools", { ordinaryTools });
              pi.setSessionName(previous.name ?? "");
            }
            if (previous.model && !await pi.setModel(previous.model)) throw new Error("无法恢复原模型");
            pi.setThinkingLevel(previous.thinking);
            pi.setActiveTools(previous.tools);
            const originalRole = previous.owner?.role ?? null;
            const config = configFor(pluginRoot, originalRole);
            if (missingRole) config.flushOnShutdown = false;
            runtime = createHermesRuntime(pi, { ...scopeFor(pluginRoot, originalRole), suppressAutomation: missingRole }, config);
            await runtime.dispatch("session_start", { type: "session_start", reason: "reload" }, ctx);
          } catch (restoreError) {
            failure = `角色切换失败且原模式恢复失败，记忆操作已停止：${restoreError instanceof Error ? restoreError.message : String(restoreError)}`;
            await runtime?.close({ type: "session_shutdown", reason: "reload" }, ctx, { skipFlush: true }).catch(() => {});
            runtime = undefined;
            throw new Error(`${error instanceof Error ? error.message : String(error)}；${failure}`);
          }
          throw new Error(`角色切换失败，已恢复原模式：${error instanceof Error ? error.message : String(error)}`);
        } finally { switching = false; }
        return;
      }
      const file = createEmptySession(pluginRoot, ctx.cwd, targetRole);
      const selection: Selection = { file: path.resolve(file), cwd: canonical(ctx.cwd),
        model: inheritedModel,
        thinking: pi.getThinkingLevel() ?? "low", ordinaryTools: role ? ordinaryTools : pi.getActiveTools(),
        ...(clearing ? { clearSessionId: ctx.sessionManager.getSessionId() } : {}) };
      const handoff = handoffs.write(selection);
      pendingHandoff = handoff;
      if (clearingRuntime) {
        const currentOwner = ownerFromEntries(ctx.sessionManager.getEntries());
        if (currentOwner) validateOwner(currentOwner, ownerFor(pluginRoot, ctx.cwd, currentOwner.role));
        validateSessionLocation(ctx.sessionManager.getSessionFile(), targetOwner);
        clearTask = clearingRuntime.scheduleClear({
          sessionId: ctx.sessionManager.getSessionId(),
          file: ctx.sessionManager.getSessionFile(),
          cwd: ctx.sessionManager.getHeader()?.cwd ?? ctx.cwd,
          ...(missingRole && currentOwner?.role ? {
            historyMemoryDir: path.join(scopeFor(pluginRoot, currentOwner.role).agentRoot, "pi-hermes-memory"),
          } : {}),
        });
      }
      switching = true;
      // Pi creates a new extension API and ctx. All setup runs in its session_start.
      // Never call the outgoing pi or ctx after an accepted replacement.
      const result = await ctx.switchSession(file, { withSession: async fresh => {
        const status = [...fresh.sessionManager.getEntries()].reverse().find(e => e.type === "custom" && e.customType === "roles-hermes-ready");
        if (clearing) {
          const resultEntry = [...fresh.sessionManager.getEntries()].reverse().find(e => e.type === "custom" && e.customType === "roles-hermes-clear-result");
          const result = resultEntry?.type === "custom" ? resultEntry.data as { sessionId: string; cleared: boolean } : undefined;
          const cleared = (result !== undefined && result.sessionId === selection.clearSessionId && result.cleared) || clearTask?.state === "cleared";
          if (!cleared) {
            fresh.ui.notify(`会话清理未完成：${clearTask?.error ?? "无法确认清理结果"}。已登记但未完成的清理将在后续启动重试。`, "error");
          } else if (status?.type === "custom" && status.data === true) {
            fresh.ui.notify("当前会话的聊天历史已清除，已进入空白会话。记忆、资料和 Skills 已保留。", "info");
          } else {
            fresh.ui.notify("旧会话的聊天历史已清除，但新会话初始化失败。记忆、资料和 Skills 已保留。", "error");
          }
          return;
        }
        if (status?.type === "custom" && status.data === true) {
          fresh.ui.notify(`已进入 ${candidate?.name ?? "普通模式"}`, "info");
        } else {
          fresh.ui.notify("目标会话初始化失败，记忆写入已停止。使用 /role off 恢复普通模式。", "error");
        }
      } });
      if (result.cancelled) {
        clearingRuntime?.cancelClear();
        switching = false;
        handoffs.remove(handoff);
        fs.unlinkSync(file);
        ctx.ui.notify(clearing ? "会话清理已取消，原会话数据已保留" : "角色切换已取消，保留当前模式", "info");
      } else {
        handoffs.removeIfPresent(handoff);
      }
    } catch (error) {
      switching = false;
      try { clearingRuntime?.cancelClear(); } catch { /* The old runtime may already have shut down. */ }
      if (pendingHandoff) handoffs.removeIfPresent(pendingHandoff);
      if (clearTask && clearTask.state !== "scheduled") {
        const history = clearTask.state === "cleared" ? "旧会话聊天历史已清除" : `会话清理未完成：${clearTask.error ?? "未知错误"}`;
        console.error(`${history}；后续处理失败：${error instanceof Error ? error.message : String(error)}`);
        return;
      }
      // If Pi itself failed to construct a replacement, its old context may
      // already be invalid. Do not reopen storage with that context.
      try { ctx.ui.notify(error instanceof Error ? error.message : String(error), "error"); }
      catch { console.error(error); }
    }
  }

  return {
    tools: template.tools,
    commands: template.commands,
    events: template.events,
    requireRuntime,
    beforeProviderRequest,
    start,
    beforeAgentStart,
    toolCall,
    shutdown,
    changeRole,
    dispatch(event: string, data: any, ctx: ExtensionContext) {
      return runtime && !failure ? runtime.dispatch(event, data, ctx) : undefined;
    },
    get view() {
      return { role, owner, failure, missingRole, initialized: Boolean(runtime) };
    },
    lockReason(ctx: ExtensionContext) {
      return requestLockReason(ctx, requestLocked);
    },
    reportCommandError(error: unknown, ctx: ExtensionCommandContext) {
      switching = false;
      try { ctx.ui.notify(error instanceof Error ? error.message : String(error), "error"); }
      catch { console.error(error); }
    },
    storage() {
      const scope = scopeFor(pluginRoot, owner?.role ?? null);
      return {
        memoryDir: configFor(pluginRoot, owner?.role ?? null).memoryDir ?? path.join(scope.agentRoot, "pi-hermes-memory"),
        projectsDir: path.join(scope.agentRoot, configFor(pluginRoot, owner?.role ?? null).projectsMemoryDir ?? "projects-memory"),
      };
    },
  };
}

export type RoleSession = ReturnType<typeof createRoleSession>;
