import { Client as PgClient } from "pg";
import { sql } from "kysely";
import type { BakorinDb } from "../db/dialects.ts";

/**
 * What instances tell each other. Messages are hints, never the data itself: every
 * instance reads changes from the realtime log in the database, so a lost message
 * delays an event until the next poll but never loses it.
 *
 * changes: new rows are in the log. user: recheck this user's streams (role change,
 * logout everywhere). token: close streams opened with this access token (logout).
 */
export type BrokerMessage =
  | { kind: "changes"; seq?: number; origin?: string }
  | { kind: "user"; userId: string; origin?: string }
  | { kind: "token"; userId: string; tokenHash: string; origin?: string };

/**
 * The fan out seam. memory is one process; postgres uses LISTEN/NOTIFY. A Redis or
 * NATS broker only has to implement these four methods.
 */
export interface RealtimeBroker {
  readonly name: string;
  /** Sent after the write commits. Must not throw: a failed publish is caught up by polling. */
  publish(message: BrokerMessage): Promise<void>;
  subscribe(handler: (message: BrokerMessage) => void): () => void;
  /** Fires after a reconnect, so the hub can catch up from the log. */
  onReconnect(handler: () => void): () => void;
  /** False while a networked broker is disconnected. */
  healthy(): boolean;
  /** Whether other instances may write: the hub then polls the log as a safety net. */
  readonly multiInstance: boolean;
  close(): Promise<void>;
}

export function createMemoryBroker(): RealtimeBroker {
  const handlers = new Set<(message: BrokerMessage) => void>();
  return {
    name: "memory",
    multiInstance: false,
    async publish(message) {
      for (const handler of handlers) {
        queueMicrotask(() => handler(message));
      }
    },
    subscribe(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    onReconnect() {
      return () => {};
    },
    healthy: () => true,
    async close() {
      handlers.clear();
    },
  };
}

export const REALTIME_CHANNEL = "bakorin_realtime";

/**
 * Postgres LISTEN/NOTIFY. One dedicated connection listens; publishes go through
 * the normal pool. The listener reconnects with backoff and announces each
 * reconnect so the hub reads anything it missed from the log.
 */
export function createPostgresBroker(options: { url: string; db: BakorinDb; channel?: string }): RealtimeBroker {
  const channel = options.channel ?? REALTIME_CHANNEL;
  const handlers = new Set<(message: BrokerMessage) => void>();
  const reconnectHandlers = new Set<() => void>();
  let client: PgClient | null = null;
  let connected = false;
  let closed = false;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const inflight = new Set<Promise<void>>();

  const dispatch = (payload: string | undefined) => {
    let message: BrokerMessage;
    try {
      message = JSON.parse(payload ?? "{}") as BrokerMessage;
    } catch {
      return;
    }
    for (const handler of handlers) {
      try {
        handler(message);
      } catch (error) {
        console.error("[bakorin] realtime broker handler failed", error);
      }
    }
  };

  const connect = async () => {
    if (closed) {
      return;
    }
    const next = new PgClient({ connectionString: options.url });
    next.on("notification", (note) => {
      if (note.channel === channel) {
        dispatch(note.payload);
      }
    });
    const lost = () => {
      if (client !== next) {
        return;
      }
      connected = false;
      client = null;
      next.removeAllListeners();
      void next.end().catch(() => undefined);
      schedule();
    };
    next.on("error", lost);
    next.on("end", lost);
    try {
      await next.connect();
      await next.query(`LISTEN ${channel}`);
      if (closed) {
        await next.end();
        return;
      }
      client = next;
      const wasReconnect = attempt > 0;
      connected = true;
      attempt = 0;
      if (wasReconnect) {
        console.log("[bakorin] realtime: LISTEN connection restored");
        for (const handler of reconnectHandlers) {
          handler();
        }
      }
    } catch (error) {
      next.removeAllListeners();
      void next.end().catch(() => undefined);
      if (!closed) {
        console.warn(`[bakorin] realtime: LISTEN connection failed (${error instanceof Error ? error.message : String(error)}), retrying`);
        schedule();
      }
    }
  };

  const schedule = () => {
    if (closed || timer) {
      return;
    }
    attempt += 1;
    const delay = Math.min(5000, 250 * 2 ** Math.min(attempt, 5)) * (0.75 + Math.random() * 0.5);
    timer = setTimeout(() => {
      timer = null;
      void connect();
    }, delay);
  };

  const ready = connect();

  return {
    name: "postgres",
    multiInstance: true,
    async publish(message) {
      if (closed) {
        return;
      }
      const sending = sql`select pg_notify(${channel}, ${JSON.stringify(message)})`
        .execute(options.db)
        .then(
          () => undefined,
          (error: unknown) => {
            if (!closed) {
              console.warn(`[bakorin] realtime: NOTIFY failed (${error instanceof Error ? error.message : String(error)})`);
            }
          },
        );
      inflight.add(sending);
      await sending;
      inflight.delete(sending);
    },
    subscribe(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    onReconnect(handler) {
      reconnectHandlers.add(handler);
      return () => reconnectHandlers.delete(handler);
    },
    healthy: () => connected,
    async close() {
      // Let publishes already sent finish before the pool goes away.
      await Promise.all([...inflight]);
      closed = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      await ready.catch(() => undefined);
      const current = client;
      client = null;
      connected = false;
      if (current) {
        current.removeAllListeners();
        await current.end().catch(() => undefined);
      }
    },
  };
}
