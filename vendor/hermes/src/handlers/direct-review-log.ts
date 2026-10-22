import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { MemoryStore } from "../store/memory-store.js";
import { canonicalStoragePath } from "../store/canonical-storage-path.js";
import { withMarkdownMutationLock } from "../store/markdown-mutation-lock.js";

export function createDirectReviewLogger(store: MemoryStore, sessionId: string | undefined, project: string | null) {
  const reviewId = randomUUID();
  const startedAt = Date.now();
  let warned = false;
  const logger = {
    reviewId,
    path: null as string | null,
    failure: null as string | null,
    async write(event: string, details: Record<string, unknown> = {}): Promise<void> {
      try {
        if (!logger.path) {
          const memoryPath = await store.getStorageIdentity("memory");
          const logPath = path.join(path.dirname(memoryPath), "logs", "direct-review.log");
          await fs.mkdir(path.dirname(logPath), { recursive: true });
          logger.path = await canonicalStoragePath(logPath);
        }
        const record = JSON.stringify({
          ...details,
          timestamp: new Date().toISOString(),
          elapsedMs: Date.now() - startedAt,
          reviewId, sessionId: sessionId ?? null, project, event,
        }) + "\n";
        const file = logger.path;
        await withMarkdownMutationLock(file, () => fs.appendFile(file, record, "utf8"));
        logger.failure = null;
      } catch (error) {
        // Diagnostics must never turn a completed review into a failed one.
        logger.failure = error instanceof Error ? error.message : String(error);
        if (!warned) {
          warned = true;
          console.warn(`[pi-hermes-memory] Direct review log unavailable (${reviewId}): ${logger.failure}`);
        }
      }
    },
  };
  return logger;
}
