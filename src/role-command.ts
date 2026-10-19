import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { listRoles } from "./roles.js";
import { ownerFromEntries } from "./storage.js";
import type { RoleSession } from "./role-session.js";

export function createRoleCommand(rolesDirectory: string, session: RoleSession) {
  return async (args: string, ctx: ExtensionCommandContext) => {
    let action: string;
    try {
      const parts = args.trim().split(" ").filter(Boolean);
      action = parts[0] ?? "current";
      if (parts.length > 1) {
        throw new Error("用法：/role <id|off>，或 /role list|current|prompt|reload|clear；模型请求开始后不能切换角色");
      }
      if (action === "list") {
        ctx.ui.notify(listRoles(rolesDirectory).map(r => `${r.id} · ${r.name}${r.description ? `：${r.description}` : ""}`).join("\n") || "没有角色", "info");
        return;
      }
      const { role, failure, missingRole, initialized } = session.view;
      if (action === "current") {
        const storage = session.storage();
        ctx.ui.notify(`${role?.name ?? "普通模式"}\n记忆：${storage.memoryDir}\n项目记忆：${storage.projectsDir}\n会话：${ctx.sessionManager.getSessionFile() ?? "未持久化"}${failure ? `\n${failure}` : ""}`, "info");
        return;
      }
      if (action === "prompt") {
        const unavailable = failure ?? (!initialized ? "会话尚未初始化" : undefined);
        const memoryReason = unavailable ?? (missingRole ? "原角色不存在，已回退普通模式" : undefined);
        const roleReason = memoryReason ?? (!role ? "普通模式无角色提示词"
          : !role.prompt ? "角色提示词为空" : undefined);
        const lines = [
          "角色提示概览",
          `当前模式：${role ? `${role.name}（${role.id}）` : "普通模式"}`,
        ];
        if (missingRole) lines.push(`原角色：${ownerFromEntries(ctx.sessionManager.getEntries())?.role ?? "未知"}（定义不存在，已回退普通模式）`);
        lines.push(
          `角色修改：${session.lockReason(ctx) ?? "允许（尚未开始模型请求）"}`,
          `角色提示注入：${roleReason ? `未启用（${roleReason}）` : "已启用"}`,
          `Hermes 记忆上下文注入：${memoryReason ? `未启用（${memoryReason}）` : "已启用"}`,
          "",
          "提示词（本会话已加载）：",
          role ? role.prompt || "（提示词为空）" : "无角色提示词",
        );
        ctx.ui.notify(lines.join("\n"), "info");
        return;
      }
    } catch (error) {
      session.reportCommandError(error, ctx);
      return;
    }
    return session.changeRole(action, ctx);
  };
}
