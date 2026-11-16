import type { ChangeEvent } from "@bakorin/core";

/** Context about the write that produced an event, for logs and error reports. */
export interface ChangeMeta {
  requestId?: string;
  ip?: string;
}

export type ChangeHandler = (event: ChangeEvent, meta: ChangeMeta) => void | Promise<void>;

export type ChangeErrorHandler = (error: unknown, event: ChangeEvent, meta: ChangeMeta) => void;

export interface ChangeBus {
  emit(event: ChangeEvent, meta?: ChangeMeta): void;
  subscribe(handler: ChangeHandler): () => void;
}

function defaultOnError(error: unknown, event: ChangeEvent, meta: ChangeMeta): void {
  const request = meta.requestId ? ` (request ${meta.requestId})` : "";
  console.error(`[bakorin] change subscriber failed for ${event.entity}.${event.op}${request}`, error);
}

/**
 * In-process change bus, emitted after a write commits. Webhooks, mail rules and
 * the audit log are written inside the write's transaction (see events/record.ts),
 * so nothing durable depends on this bus. It feeds after* hooks today and is the
 * place a realtime layer (SSE/WebSocket with per-subscriber read-policy filtering,
 * or Postgres LISTEN/NOTIFY for multi-instance) should subscribe later.
 *
 * A subscriber that throws or rejects never reaches the caller or the process: the
 * error goes to onError and the next subscriber still runs.
 */
export function createChangeBus(options: { onError?: ChangeErrorHandler } = {}): ChangeBus {
  const handlers = new Set<ChangeHandler>();
  const onError = options.onError ?? defaultOnError;
  const report = (error: unknown, event: ChangeEvent, meta: ChangeMeta) => {
    try {
      onError(error, event, meta);
    } catch (reportError) {
      console.error("[bakorin] change bus error handler failed", reportError);
    }
  };
  return {
    emit(event, meta = {}) {
      for (const handler of handlers) {
        try {
          const result = handler(event, meta);
          if (result && typeof (result as Promise<void>).then === "function") {
            (result as Promise<void>).then(undefined, (error: unknown) => report(error, event, meta));
          }
        } catch (error) {
          report(error, event, meta);
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
