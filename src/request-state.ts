import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { OWNER_ENTRY } from "./storage.js";

export const REQUEST_ENTRY = "roles-hermes-request-state";

export function requestLockReason(ctx: ExtensionContext, requestLocked: boolean): string | undefined {
  if (requestLocked) return "本会话已锁定，不能改变角色提示";
  const entries = ctx.sessionManager.getEntries();
  const states = entries.filter(e => e.type === "custom" && e.customType === REQUEST_ENTRY);
  if (states.some(e => e.type === "custom" && (e.data as { status?: string } | undefined)?.status !== "unrequested"))
    return "本会话已锁定，或请求状态记录无效";
  if (entries.some(e => ["compaction", "branch_summary", "usage", "context_edit", "custom_message"].includes(e.type)
    || (e.type === "message" && e.message.role !== "user"))) return "本会话已有模型上下文";
  if (!states.length && entries.some(e => !["model_change", "thinking_level_change", "session_info", "label"].includes(e.type)
    && !(e.type === "custom" && [OWNER_ENTRY, "roles-hermes-tools", "roles-hermes-ready", "roles-hermes-clear-result"].includes(e.customType))))
    return "旧会话已有内容，无法确认是否请求过远端模型";
  return undefined;
}
