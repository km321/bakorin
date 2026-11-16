import type { BakorinDb } from "../db/dialects.ts";
import { acquireLease, instanceHolder } from "../db/leases.ts";

/**
 * The delivery queue shared by the webhook and mail outboxes: one worker loop,
 * one lease per queue, retry backoff, cleanup, and discard. Each outbox supplies
 * how to find due rows and how to deliver one.
 *
 * Rows are grouped into lanes by key (the webhook host, or the mail provider).
 * A lane delivers its rows in order, perLane at a time, and up to maxLanes lanes
 * run at once, so one slow endpoint does not hold up the others.
 */

/** Wait before the next attempt: 200 ms doubling to a cap of 60 seconds. */
export function retryDelayMs(attempts: number): number {
  return Math.min(60_000, 100 * 2 ** Math.min(attempts, 8));
}

export interface DrainOptions {
  stopped?: () => boolean;
  holder?: string;
}

export interface QueueSpec<Row> {
  /** Lease name, so one instance drains this queue at a time. */
  lease: string;
  /** Runs once per drain before rows are read (cleanup, stuck row recovery). */
  prepare?: () => Promise<void>;
  /** Due rows, oldest first. */
  due: (limit: number) => Promise<Row[]>;
  /** Lane for a row. Rows in one lane go out in order. */
  laneOf: (row: Row) => string;
  /** Claims and delivers one row. Must not throw for a normal delivery failure. */
  deliver: (row: Row) => Promise<void>;
  /** Rows read per drain. Default 20. */
  batch?: number;
  /** Rows a lane sends at once. Default 1. */
  perLane?: number;
  /** Lanes that run at once. Default 8. */
  maxLanes?: number;
}

const LEASE_MS = 15_000;

/** One pass over the queue. Database errors during shutdown are ignored. */
export async function drainQueue<Row>(db: BakorinDb, spec: QueueSpec<Row>, options: DrainOptions = {}): Promise<void> {
  const stopped = options.stopped ?? (() => false);
  const holder = options.holder ?? instanceHolder();
  if (stopped()) {
    return;
  }
  try {
    const got = await acquireLease(db, spec.lease, holder, LEASE_MS);
    if (!got || stopped()) {
      return;
    }
    await spec.prepare?.();
    const rows = await spec.due(spec.batch ?? 20);
    await runLanes(rows, spec, stopped);
  } catch {
    // Database already closed during shutdown.
  }
}

/** Delivers rows lane by lane, keeping the order inside each lane. */
export async function runLanes<Row>(
  rows: Row[],
  spec: Pick<QueueSpec<Row>, "laneOf" | "deliver" | "perLane" | "maxLanes">,
  stopped: () => boolean = () => false,
): Promise<void> {
  const lanes = new Map<string, Row[]>();
  for (const row of rows) {
    const key = spec.laneOf(row);
    const lane = lanes.get(key);
    if (lane) lane.push(row);
    else lanes.set(key, [row]);
  }
  const perLane = Math.max(1, spec.perLane ?? 1);
  const runLane = async (lane: Row[]) => {
    for (let index = 0; index < lane.length && !stopped(); index += perLane) {
      await Promise.all(lane.slice(index, index + perLane).map((row) => spec.deliver(row)));
    }
  };
  const queue = [...lanes.values()];
  const workers = Array.from({ length: Math.min(Math.max(1, spec.maxLanes ?? 8), queue.length) }, async () => {
    for (let lane = queue.shift(); lane && !stopped(); lane = queue.shift()) {
      await runLane(lane);
    }
  });
  await Promise.all(workers);
}

/**
 * Drains every second (and once at start). A drain still running when the next
 * tick comes is not started twice. Returns a stop function.
 */
export function startQueueWorker(drain: (options: DrainOptions) => Promise<void>, intervalMs = 1000): () => void {
  const holder = instanceHolder();
  let stopped = false;
  let running = false;
  const tick = () => {
    if (stopped || running) {
      return;
    }
    running = true;
    void drain({ stopped: () => stopped, holder }).finally(() => {
      running = false;
    });
  };
  const timer = setInterval(tick, intervalMs);
  tick();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

/** Deletes finished rows (sent or delivered) and discarded rows older than retainDays. */
export async function cleanupFinished(
  db: BakorinDb,
  table: string,
  finished: { status: string; at: string },
  retainDays: number,
): Promise<number> {
  const cutoff = new Date(Date.now() - retainDays * 24 * 60 * 60 * 1000).toISOString();
  const done = await db.deleteFrom(table).where("status", "=", finished.status).where(finished.at, "<", cutoff).executeTakeFirst();
  const discarded = await db.deleteFrom(table).where("status", "=", "discarded").where("created_at", "<", cutoff).executeTakeFirst();
  return Number(done?.numDeletedRows ?? 0) + Number(discarded?.numDeletedRows ?? 0);
}

/** Marks a failed row as discarded so it stops counting as a failure. The row is kept for the record. */
export async function discardFailed(db: BakorinDb, table: string, id: string): Promise<"ok" | "missing" | "not_failed"> {
  const row = await db.selectFrom(table).select(["status"]).where("id", "=", id).executeTakeFirst();
  if (!row) {
    return "missing";
  }
  if (String(row.status) !== "failed") {
    return "not_failed";
  }
  await db.updateTable(table).set({ status: "discarded", locked_until: null }).where("id", "=", id).execute();
  return "ok";
}
