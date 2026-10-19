import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createRoleSession } from "./role-session.js";
import { createRoleCommand } from "./role-command.js";

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rolesDirectory = path.join(pluginRoot, "roles");

export default function rolesHermes(pi: ExtensionAPI) {
  const session = createRoleSession(pi, pluginRoot);

  for (const [name, tool] of session.tools) {
    pi.registerTool({ ...tool,
      execute: (...args) => session.requireRuntime().execute(name, ...args),
    });
  }
  for (const [name, command] of session.commands) {
    pi.registerCommand(name, { ...command, handler: (...args) => session.requireRuntime().command(name, ...args) });
  }

  pi.on("before_provider_request", session.beforeProviderRequest);
  pi.on("session_start", session.start);
  for (const name of session.events.filter(e => !["session_start", "session_shutdown", "before_agent_start"].includes(e))) {
    const on = pi.on as (event: string, handler: (event: any, ctx: ExtensionContext) => any) => () => void;
    on(name, session.dispatch.bind(null, name));
  }
  pi.on("before_agent_start", session.beforeAgentStart);
  pi.on("tool_call", session.toolCall);
  pi.on("session_shutdown", session.shutdown);

  pi.registerCommand("role", {
    description: "角色：list、current、prompt、<id>、off、reload、clear（模型请求开始后禁止切换）",
    handler: createRoleCommand(rolesDirectory, session),
  });
}
