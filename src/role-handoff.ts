import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import type { Role, Thinking } from "./roles.js";
import { canonical, type Owner } from "./storage.js";

export interface Selection {
  file: string; cwd: string; model?: string; thinking: Thinking; ordinaryTools: string[]; clearSessionId?: string;
  rollback?: { role?: Role; owner: Owner; storedOwner: Owner; ordinaryTools: string[]; tools: string[];
    model?: string; thinking: Thinking; suppressPrompt: boolean; missingRole: boolean; name?: string };
}

export function createRoleHandoff(pluginRoot: string) {
  const pathFor = (file: string) => path.join(pluginRoot, ".state", "handoff", createHash("sha256").update(path.toNamespacedPath(path.resolve(file))).digest("hex") + ".json");

  return {
    pathFor,
    read(file: string, cwd: string): Selection | undefined {
      const handoff = pathFor(file);
      if (!fs.existsSync(handoff)) return undefined;
      const selection = JSON.parse(fs.readFileSync(handoff, "utf8")) as Selection;
      if (path.toNamespacedPath(selection.file) !== path.toNamespacedPath(path.resolve(file)) || selection.cwd !== canonical(cwd)
        || !Array.isArray(selection.ordinaryTools) || !selection.ordinaryTools.every(t => typeof t === "string")
        || (selection.clearSessionId !== undefined && (typeof selection.clearSessionId !== "string" || !selection.clearSessionId))
        || !["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(selection.thinking)) {
        throw new Error("Invalid role-switch handoff");
      }
      return selection;
    },
    write(selection: Selection): string {
      const handoff = pathFor(selection.file);
      fs.mkdirSync(path.dirname(handoff), { recursive: true });
      fs.writeFileSync(handoff, JSON.stringify(selection), { encoding: "utf8", flag: "wx" });
      return handoff;
    },
    remove(handoff: string): void {
      fs.unlinkSync(handoff);
    },
    removeIfPresent(handoff: string): void {
      if (fs.existsSync(handoff)) fs.unlinkSync(handoff);
    },
  };
}
