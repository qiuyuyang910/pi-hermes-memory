import { AsyncLocalStorage } from "node:async_hooks";

export interface HermesScope {
  agentRoot: string;
  sessionsDir: string;
  isolated: boolean;
  closers?: Map<string, () => void>;
}

// Async children retain their owner's scope after the active role changes.
export const hermesScope = new AsyncLocalStorage<HermesScope>();
