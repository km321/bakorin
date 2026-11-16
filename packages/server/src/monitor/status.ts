import { access, constants, mkdir, stat } from "node:fs/promises";
import { Hono } from "hono";
import { sql } from "kysely";
import type { SchemaAST } from "@bakorin/core";
import { requireAdmin } from "../auth/guard.ts";
import type { AppContext } from "../context.ts";
import type { BakorinDb } from "../db/dialects.ts";
import { MAIL_OUTBOX_TABLE, metaGet, WEBHOOK_OUTBOX_TABLE } from "../db/system.ts";
import { resolveRuntimePath } from "../paths.ts";
import type { Monitor } from "./monitor.ts";

export interface QueueStats {
  pending: number;
  retrying: number;
  sending: number;
  failed: number;
  done: number;
  discarded: number;
  oldestPendingAt: string | null;
  oldestPendingAgeSeconds: number | null;
}

export interface FailedItem {
  id: string;
  target: string;
  label: string;
  attempts: number;
  lastError: string | null;
  createdAt: string;
}

export interface BackupStatus {
  lastAt: string | null;
  lastLocation: string | null;
  intervalHours: number | null;
  maxAgeHours: number | null;
  overdue: boolean;
}

async function queueStats(db: BakorinDb, table: string, doneStatus: string): Promise<QueueStats> {
  const rows = (await db
    .selectFrom(table)
    .select((eb) => [
      "status",
      eb.fn.countAll().as("n"),
      eb.fn.min("created_at").as("oldest"),
      sql<number>`sum(case when attempts > 0 then 1 else 0 end)`.as("retried"),
    ])
    .groupBy("status")
    .execute()) as Array<{ status: string; n: number | string | bigint; oldest: string | null; retried: number | string | null }>;
  const stats: QueueStats = {
    pending: 0,
    retrying: 0,
    sending: 0,
    failed: 0,
    done: 0,
    discarded: 0,
    oldestPendingAt: null,
    oldestPendingAgeSeconds: null,
  };
  for (const row of rows) {
    const count = Number(row.n);
    switch (row.status) {
      case "pending": {
        const retried = Number(row.retried ?? 0);
        stats.retrying = retried;
        stats.pending = count - retried;
        stats.oldestPendingAt = row.oldest;
        break;
      }
      case "sending":
        stats.sending = count;
        break;
      case "failed":
        stats.failed = count;
        break;
      case "discarded":
        stats.discarded = count;
        break;
      default:
        if (row.status === doneStatus) {
          stats.done = count;
        }
    }
  }
  if (stats.oldestPendingAt) {
    stats.oldestPendingAgeSeconds = Math.max(0, Math.round((Date.now() - Date.parse(stats.oldestPendingAt)) / 1000));
  }
  return stats;
}

function urlTarget(raw: string): string {
  try {
    const url = new URL(raw);
    return `${url.origin}${url.pathname}`;
  } catch {
    return "invalid url";
  }
}

async function failedMail(db: BakorinDb, limit: number): Promise<FailedItem[]> {
  const rows = (await db
    .selectFrom(MAIL_OUTBOX_TABLE)
    .select(["id", "to_addrs", "subject", "template", "attempts", "last_error", "created_at"])
    .where("status", "=", "failed")
    .orderBy("created_at", "desc")
    .limit(limit)
    .execute()) as Array<Record<string, unknown>>;
  return rows.map((row) => {
    let to = "";
    try {
      to = (JSON.parse(String(row.to_addrs ?? "[]")) as string[]).join(", ");
    } catch {
      to = String(row.to_addrs ?? "");
    }
    return {
      id: String(row.id),
      target: to,
      label: String(row.subject || row.template || "(no subject)"),
      attempts: Number(row.attempts ?? 0),
      lastError: row.last_error ? String(row.last_error) : null,
      createdAt: String(row.created_at),
    };
  });
}

async function failedWebhooks(db: BakorinDb, limit: number): Promise<FailedItem[]> {
  const rows = (await db
    .selectFrom(WEBHOOK_OUTBOX_TABLE)
    .select(["id", "url", "event", "webhook_id", "attempts", "last_error", "created_at"])
    .where("status", "=", "failed")
    .orderBy("created_at", "desc")
    .limit(limit)
    .execute()) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    id: String(row.id),
    target: urlTarget(String(row.url ?? "")),
    label: String(row.event || row.webhook_id || "webhook"),
    attempts: Number(row.attempts ?? 0),
    lastError: row.last_error ? String(row.last_error) : null,
    createdAt: String(row.created_at),
  }));
}

export async function databaseSize(ast: SchemaAST, db: BakorinDb, projectDir: string): Promise<number | null> {
  try {
    if (ast.runtime.dialect === "postgres") {
      const result = await sql<{ size: string | number }>`select pg_database_size(current_database()) as size`.execute(db);
      return Number(result.rows[0]?.size ?? 0);
    }
    const path = resolveRuntimePath(projectDir, ast.runtime.sqlitePath);
    let total = 0;
    for (const file of [path, `${path}-wal`]) {
      try {
        total += (await stat(file)).size;
      } catch {
        // no wal yet
      }
    }
    return total;
  } catch {
    return null;
  }
}

/** Hours without a backup before it counts as overdue: alerts setting, else twice the schedule. */
export function backupMaxAgeHours(ast: SchemaAST): number | null {
  if (ast.runtime.alerts.backupMaxAgeHours) {
    return ast.runtime.alerts.backupMaxAgeHours;
  }
  return ast.runtime.backups.intervalHours ? ast.runtime.backups.intervalHours * 2 : null;
}

export async function backupStatus(ast: SchemaAST, db: BakorinDb, startedAt: Date): Promise<BackupStatus> {
  const lastAt = await metaGet(db, "last_backup_at");
  const lastLocation = await metaGet(db, "last_backup_location");
  const maxAge = backupMaxAgeHours(ast);
  let overdue = false;
  if (maxAge) {
    const since = lastAt ? Date.parse(lastAt) : startedAt.getTime();
    overdue = Date.now() - since > maxAge * 60 * 60 * 1000;
  }
  return { lastAt, lastLocation, intervalHours: ast.runtime.backups.intervalHours, maxAgeHours: maxAge, overdue };
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error("timed out")), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export interface ReadyCheck {
  ok: boolean;
  ms: number;
  error?: string;
}

export async function readiness(ctx: AppContext): Promise<{ ok: boolean; checks: { database: ReadyCheck; storage: ReadyCheck } }> {
  const time = async (fn: () => Promise<unknown>): Promise<ReadyCheck> => {
    const started = performance.now();
    try {
      await withTimeout(fn(), 3000);
      return { ok: true, ms: Math.round(performance.now() - started) };
    } catch (error) {
      const message = error instanceof Error && error.message === "timed out" ? "timed out" : "unavailable";
      return { ok: false, ms: Math.round(performance.now() - started), error: message };
    }
  };
  const database = await time(() => sql`select 1`.execute(ctx.db));
  const storage = await time(async () => {
    if (ctx.ast.runtime.files.driver === "s3") {
      await ctx.files.list("__bakorin_ready__/");
      return;
    }
    const dir = resolveRuntimePath(ctx.projectDir, ctx.ast.runtime.files.path);
    await mkdir(dir, { recursive: true });
    await access(dir, constants.W_OK);
  });
  return { ok: database.ok && storage.ok, checks: { database, storage } };
}

export async function collectStatus(ctx: AppContext, monitor: Monitor) {
  const [mail, webhooks, dbSize, backups] = await Promise.all([
    queueStats(ctx.db, MAIL_OUTBOX_TABLE, "sent"),
    queueStats(ctx.db, WEBHOOK_OUTBOX_TABLE, "delivered"),
    databaseSize(ctx.ast, ctx.db, ctx.projectDir),
    backupStatus(ctx.ast, ctx.db, monitor.startedAt),
  ]);
  const [mailFailed, webhookFailed] = await Promise.all([failedMail(ctx.db, 20), failedWebhooks(ctx.db, 20)]);
  const alerts = ctx.ast.runtime.alerts;
  return {
    app: ctx.ast.appName,
    version: monitor.version,
    commit: monitor.commit,
    runtime: `bun ${Bun.version}`,
    startedAt: monitor.startedAt.toISOString(),
    uptimeSeconds: Math.round((Date.now() - monitor.startedAt.getTime()) / 1000),
    database: { dialect: ctx.ast.runtime.dialect, sizeBytes: dbSize },
    storage: { driver: ctx.ast.runtime.files.driver },
    queues: {
      mail: { ...mail, failedItems: mailFailed },
      webhooks: { ...webhooks, failedItems: webhookFailed },
    },
    errors: { total: monitor.errorsTotal, recent: monitor.recentErrors().slice(0, 20), forwarding: monitor.errorForwarding },
    backups,
    alerts: {
      email: alerts.email.length > 0,
      webhook: Boolean(alerts.webhook),
      backupMaxAgeHours: alerts.backupMaxAgeHours,
      checkIntervalMinutes: alerts.checkIntervalMinutes,
    },
    logging: monitor.logMode,
    metrics: monitor.metricsEnabled,
    realtime: realtimeStatus(ctx),
    mcp: { enabled: ctx.ast.runtime.mcp.enabled, tokenConfigured: Boolean(ctx.mcpToken) },
  };
}

function realtimeStatus(ctx: AppContext) {
  const entities = ctx.ast.entities.filter((entity) => entity.realtime).map((entity) => ({ name: entity.name, mode: entity.realtime! }));
  const stats = ctx.realtime?.stats();
  return {
    enabled: entities.length > 0,
    entities,
    broker: stats?.broker ?? "memory",
    brokerHealthy: stats?.brokerHealthy ?? false,
    connections: stats?.connections ?? 0,
    connectionsByEntity: stats?.connectionsByEntity ?? {},
    users: stats?.users ?? 0,
    maxConnections: ctx.ast.runtime.realtime.maxConnections,
    eventsTotal: stats?.eventsTotal ?? 0,
    deliveriesTotal: stats?.deliveriesTotal ?? 0,
    droppedSlowTotal: stats?.droppedSlowTotal ?? 0,
    lastEventId: stats?.cursor ?? 0,
  };
}

export type StatusReport = Awaited<ReturnType<typeof collectStatus>>;

export function createStatusRoutes(monitor: Monitor): Hono {
  const app = new Hono();
  app.get("/", async (c) => {
    const denied = requireAdmin(c);
    if (denied) {
      return denied;
    }
    const data = await collectStatus(c.get("app"), monitor);
    return c.json({ data }, 200, { "cache-control": "no-store" });
  });
  return app;
}

/** Extra Prometheus lines that need the database. */
export async function metricsExtras(ctx: AppContext, monitor: Monitor): Promise<string[]> {
  const lines: string[] = [];
  const [mail, webhooks, size, backups] = await Promise.all([
    queueStats(ctx.db, MAIL_OUTBOX_TABLE, "sent"),
    queueStats(ctx.db, WEBHOOK_OUTBOX_TABLE, "delivered"),
    databaseSize(ctx.ast, ctx.db, ctx.projectDir),
    backupStatus(ctx.ast, ctx.db, monitor.startedAt),
  ]);
  lines.push("# HELP bakorin_outbox_items Outbox items by queue and state.", "# TYPE bakorin_outbox_items gauge");
  for (const [queue, stats] of [
    ["mail", mail],
    ["webhooks", webhooks],
  ] as const) {
    for (const state of ["pending", "retrying", "sending", "failed"] as const) {
      lines.push(`bakorin_outbox_items{queue="${queue}",state="${state}"} ${stats[state]}`);
    }
  }
  lines.push(
    "# HELP bakorin_outbox_oldest_pending_seconds Age of the oldest pending item.",
    "# TYPE bakorin_outbox_oldest_pending_seconds gauge",
    `bakorin_outbox_oldest_pending_seconds{queue="mail"} ${mail.oldestPendingAgeSeconds ?? 0}`,
    `bakorin_outbox_oldest_pending_seconds{queue="webhooks"} ${webhooks.oldestPendingAgeSeconds ?? 0}`,
  );
  if (size !== null) {
    lines.push("# HELP bakorin_db_size_bytes Database size.", "# TYPE bakorin_db_size_bytes gauge", `bakorin_db_size_bytes ${size}`);
  }
  const realtime = ctx.realtime?.stats();
  if (realtime) {
    lines.push(
      "# HELP bakorin_realtime_connections Open realtime streams on this instance.",
      "# TYPE bakorin_realtime_connections gauge",
      `bakorin_realtime_connections ${realtime.connections}`,
      "# HELP bakorin_realtime_users Distinct users (or signed out IPs) with an open stream.",
      "# TYPE bakorin_realtime_users gauge",
      `bakorin_realtime_users ${realtime.users}`,
      "# HELP bakorin_realtime_events_total Changes read from the realtime log.",
      "# TYPE bakorin_realtime_events_total counter",
      `bakorin_realtime_events_total ${realtime.eventsTotal}`,
      "# HELP bakorin_realtime_deliveries_total Events written to client streams.",
      "# TYPE bakorin_realtime_deliveries_total counter",
      `bakorin_realtime_deliveries_total ${realtime.deliveriesTotal}`,
      "# HELP bakorin_realtime_frames_built_total Event frames serialized (shared across subscribers with the same policy context).",
      "# TYPE bakorin_realtime_frames_built_total counter",
      `bakorin_realtime_frames_built_total ${realtime.framesBuiltTotal}`,
      "# HELP bakorin_realtime_dropped_slow_total Streams dropped because the client could not keep up.",
      "# TYPE bakorin_realtime_dropped_slow_total counter",
      `bakorin_realtime_dropped_slow_total ${realtime.droppedSlowTotal}`,
      "# HELP bakorin_realtime_rejected_total Stream requests refused, by reason.",
      "# TYPE bakorin_realtime_rejected_total counter",
      ...Object.entries(realtime.rejectedTotal).map(([reason, count]) => `bakorin_realtime_rejected_total{reason="${reason}"} ${count}`),
      "# HELP bakorin_realtime_broker_up 1 when the realtime broker is connected.",
      "# TYPE bakorin_realtime_broker_up gauge",
      `bakorin_realtime_broker_up{broker="${realtime.broker}"} ${realtime.started ? (realtime.brokerHealthy ? 1 : 0) : 0}`,
    );
  }
  lines.push(
    "# HELP bakorin_last_backup_timestamp_seconds Unix time of the last successful backup, 0 if none.",
    "# TYPE bakorin_last_backup_timestamp_seconds gauge",
    `bakorin_last_backup_timestamp_seconds ${backups.lastAt ? Math.round(Date.parse(backups.lastAt) / 1000) : 0}`,
  );
  return lines;
}
