import * as fs from "node:fs";
import * as path from "node:path";
import { parseFrontmatter } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export type Thinking = ReturnType<ExtensionAPI["getThinkingLevel"]>;
export interface Role {
  id: string;
  name: string;
  description: string;
  prompt: string;
  model?: string;
  thinking?: Thinking;
  tools?: string[];
}

export function validRoleId(id: string): boolean {
  return id.length > 0 && id.length <= 64 && !["off", "list", "current", "prompt", "reload", "clear"].includes(id)
    && [...id].every(c => "abcdefghijklmnopqrstuvwxyz0123456789_-".includes(c));
}

export function loadRole(directory: string, id: string): Role {
  if (!validRoleId(id)) throw new Error(`Invalid role identifier: ${id}`);
  const { frontmatter: values, body } = parseFrontmatter(fs.readFileSync(path.join(directory, `${id}.md`), "utf8"));
  for (const key of Object.keys(values)) {
    if (!["name", "description", "model", "thinking", "tools"].includes(key)) throw new Error(`Unsupported role field: ${key}`);
  }
  for (const key of ["name", "description", "model", "thinking"]) {
    if (values[key] !== undefined && (typeof values[key] !== "string" || !(values[key] as string).trim())) {
      throw new Error(`${id}: ${key} must be a nonempty string`);
    }
  }
  const thinking = values.thinking as Thinking | undefined;
  if (thinking && !["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(thinking)) {
    throw new Error(`${id}: invalid thinking level`);
  }
  if (values.tools !== undefined && (!Array.isArray(values.tools) || !values.tools.every(t => typeof t === "string" && t.length > 0))) {
    throw new Error(`${id}: tools must be a YAML array of tool names`);
  }
  return { id, name: (values.name as string | undefined) ?? id,
    description: (values.description as string | undefined) ?? "", prompt: body.trim(),
    model: values.model as string | undefined, thinking, tools: values.tools as string[] | undefined };
}

export function listRoles(directory: string): Role[] {
  return fs.readdirSync(directory).filter(name => name.endsWith(".md"))
    .map(name => loadRole(directory, name.slice(0, -3))).sort((a, b) => a.id.localeCompare(b.id));
}
