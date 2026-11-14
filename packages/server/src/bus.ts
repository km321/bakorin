import type { ChangeEvent } from "@bakorin/core";

export type ChangeHandler = (event: ChangeEvent) => void | Promise<void>;

export interface ChangeBus {
  emit(event: ChangeEvent): void;
  subscribe(handler: ChangeHandler): () => void;
}

/**
 * In-process change bus. Every successful create/update/delete goes through
 * emit() so webhooks and after* hooks share one path. A later realtime layer
 * (SSE/WebSocket with per-subscriber read-policy filtering, or Postgres
 * LISTEN/NOTIFY for multi-instance) should subscribe here rather than hooking
 * CRUD internals.
 */
export function createChangeBus(): ChangeBus {
  const handlers = new Set<ChangeHandler>();
  return {
    emit(event) {
      for (const handler of handlers) {
        try {
          const result = handler(event);
          if (result && typeof result.then === "function") {
            void result.catch((error: unknown) => {
              console.error("[bakorin] change bus subscriber failed", error);
            });
          }
        } catch (error) {
          console.error("[bakorin] change bus subscriber failed", error);
        }
      }
    },
    subscribe(handler) {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },
  };
}
