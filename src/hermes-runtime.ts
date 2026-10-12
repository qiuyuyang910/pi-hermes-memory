import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import installHermes from "../vendor/hermes/src/index.js";
import type { MemoryConfig } from "../vendor/hermes/src/types.js";
import { hermesScope, type HermesScope } from "../vendor/hermes/src/runtime-scope.js";

type Tool = Parameters<ExtensionAPI["registerTool"]>[0];
type Command = Parameters<ExtensionAPI["registerCommand"]>[1];
type Handler = (event: any, ctx: ExtensionContext) => any;

export function createHermesRuntime(pi: ExtensionAPI, scope: HermesScope, config: MemoryConfig) {
  scope = { ...scope, closers: new Map() };
  const tools = new Map<string, Tool>();
  const commands = new Map<string, Command>();
  const handlers = new Map<string, Handler[]>();
  const pending = new Set<Promise<unknown>>();
  let closing = false;
  let closePromise: Promise<void> | undefined;

  const api = {
    ...pi,
    registerTool(tool: Tool) { tools.set(tool.name, tool); },
    registerCommand(name: string, command: Command) { commands.set(name, command); },
    on(event: string, handler: Handler) {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
      return () => { const index = list.indexOf(handler); if (index >= 0) list.splice(index, 1); };
    },
  } as ExtensionAPI;
  hermesScope.run(scope, () => installHermes(api, config));

  function run<T>(work: () => Promise<T> | T): Promise<T> {
    if (closing) return Promise.reject(new Error("Hermes runtime is closed"));
    const promise = hermesScope.run(scope, async () => work());
    pending.add(promise);
    void promise.then(() => pending.delete(promise), () => pending.delete(promise));
    return promise;
  }

  async function emit(event: string, data: any, ctx: ExtensionContext) {
    let result: any;
    for (const handler of handlers.get(event) ?? []) {
      const next = await handler(data, ctx);
      if (next) result = { ...result, ...next };
    }
    return result;
  }

  return {
    tools, commands, events: [...handlers.keys()], scope,
    dispatch(event: string, data: any, ctx: ExtensionContext) {
      return run(() => emit(event, data, ctx));
    },
    execute(name: string, ...args: Parameters<Tool["execute"]>) {
      return run(() => {
        const tool = tools.get(name);
        if (!tool) throw new Error(`Unknown Hermes tool: ${name}`);
        return tool.execute(...args);
      });
    },
    command(name: string, ...args: Parameters<Command["handler"]>) {
      return run(() => {
        const command = commands.get(name);
        if (!command) throw new Error(`Unknown Hermes command: ${name}`);
        return command.handler(...args);
      });
    },
    close(data: any, ctx: ExtensionContext): Promise<void> {
      closePromise ??= hermesScope.run(scope, async () => {
        closing = true;
        await Promise.allSettled([...pending]);
        const errors: unknown[] = [];
        // Always reach the final database close, even when an earlier flush fails.
        for (const handler of handlers.get("session_shutdown") ?? []) {
          try { await handler(data, ctx); } catch (error) { errors.push(error); }
        }
        for (const close of scope.closers?.values() ?? []) {
          try { close(); } catch (error) { errors.push(error); }
        }
        scope.closers?.clear();
        if (errors.length) throw new AggregateError(errors, "Hermes shutdown failed");
      });
      return closePromise;
    },
  };
}

export type HermesRuntime = ReturnType<typeof createHermesRuntime>;
