/** Run a job handler once and record the result. */

import { latestCronOccurrenceAtOrBefore, parseCron, type JobAST } from "@bakorin/core";
import type { Actor, AppContext } from "../context.ts";
import { acquireLease, instanceHolder, releaseLease } from "../db/leases.ts";
import { JOB_RUNS_TABLE, metaGet, metaSet } from "../db/system.ts";
import type { JobContext, JobRunResult, JobTrigger } from "../hooks/types.ts";

export type JobRunStatus = "running" | "ok" | "error";

export interface JobRunRow {
  id: string;
  jobName: string;
  handler: string;
  trigger: JobTrigger;
  status: JobRunStatus;
  dryRun: boolean;
  scheduledFor: string | null;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  message: string | null;
  log: string | null;
  data: unknown;
  actorId: string | null;
}

export interface RunJobOptions {
  trigger: JobTrigger;
  dryRun?: boolean;
  scheduledFor?: Date | null;
  actor?: Actor | null;
}

function isUniqueConstraint(error: unknown): boolean {
  const code = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
  const message = error instanceof Error ? error.message : "";
  return code === "23505" || code === "ER_DUP_ENTRY" || /UNIQUE|constraint failed/i.test(`${code} ${message}`);
}

function serializeData(data: unknown): string | null {
  if (data === undefined) {
    return null;
  }
  try {
    return JSON.stringify(data);
  } catch {
    return JSON.stringify({ error: "job data was not JSON serializable" });
  }
}

function parseData(raw: unknown): unknown {
  if (raw === null || raw === undefined || raw === "") {
    return null;
  }
  if (typeof raw !== "string") {
    return raw;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function asBool(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "t" || value === "true";
}

export function viewJobRun(row: Record<string, unknown>): JobRunRow {
  return {
    id: String(row.id ?? ""),
    jobName: String(row.job_name ?? ""),
    handler: String(row.handler ?? ""),
    trigger: row.trigger === "manual" ? "manual" : "scheduled",
    status: row.status === "ok" || row.status === "error" || row.status === "running" ? row.status : "error",
    dryRun: asBool(row.dry_run),
    scheduledFor: row.scheduled_for == null ? null : String(row.scheduled_for),
    startedAt: String(row.started_at ?? ""),
    finishedAt: row.finished_at == null ? null : String(row.finished_at),
    durationMs: row.duration_ms == null ? null : Number(row.duration_ms),
    message: row.message == null ? null : String(row.message),
    log: row.log == null ? null : String(row.log),
    data: parseData(row.data),
    actorId: row.actor_id == null ? null : String(row.actor_id),
  };
}

export async function getJobRun(db: AppContext["db"], id: string): Promise<JobRunRow | null> {
  const row = await db.selectFrom(JOB_RUNS_TABLE).selectAll().where("id", "=", id).executeTakeFirst();
  return row ? viewJobRun(row as Record<string, unknown>) : null;
}

export async function listJobRuns(
  db: AppContext["db"],
  params: { job?: string; status?: JobRunStatus; limit: number; offset: number },
): Promise<{ data: JobRunRow[]; total: number }> {
  let countQuery = db.selectFrom(JOB_RUNS_TABLE).select(db.fn.countAll().as("count"));
  let listQuery = db.selectFrom(JOB_RUNS_TABLE).selectAll();
  if (params.job) {
    countQuery = countQuery.where("job_name", "=", params.job);
    listQuery = listQuery.where("job_name", "=", params.job);
  }
  if (params.status) {
    countQuery = countQuery.where("status", "=", params.status);
    listQuery = listQuery.where("status", "=", params.status);
  }
  const totalRow = await countQuery.executeTakeFirst();
  const rows = await listQuery.orderBy("started_at", "desc").limit(params.limit).offset(params.offset).execute();
  return { data: rows.map((row) => viewJobRun(row as Record<string, unknown>)), total: Number(totalRow?.count ?? 0) };
}

export async function lastRunsByJob(db: AppContext["db"], names: string[]): Promise<Record<string, JobRunRow>> {
  const out: Record<string, JobRunRow> = {};
  if (names.length === 0) {
    return out;
  }
  // One query per job keeps this portable across SQLite and Postgres.
  for (const name of names) {
    const row = await db
      .selectFrom(JOB_RUNS_TABLE)
      .selectAll()
      .where("job_name", "=", name)
      .orderBy("started_at", "desc")
      .limit(1)
      .executeTakeFirst();
    if (row) {
      out[name] = viewJobRun(row as Record<string, unknown>);
    }
  }
  return out;
}

async function appendLog(db: AppContext["db"], id: string, lines: string[]): Promise<void> {
  if (lines.length === 0) {
    return;
  }
  const row = await db.selectFrom(JOB_RUNS_TABLE).select("log").where("id", "=", id).executeTakeFirst();
  const previous = row?.log == null ? "" : String(row.log);
  const next = previous ? `${previous}\n${lines.join("\n")}` : lines.join("\n");
  await db.updateTable(JOB_RUNS_TABLE).set({ log: next }).where("id", "=", id).execute();
}

export async function sweepStaleJobRuns(ctx: AppContext, now = new Date()): Promise<number> {
  const jobs = ctx.ast.jobs ?? [];
  const timeoutByName = new Map(jobs.map((job) => [job.name, job.timeoutSeconds]));
  const rows = await ctx.db.selectFrom(JOB_RUNS_TABLE).selectAll().where("status", "=", "running").execute();
  let count = 0;
  for (const raw of rows) {
    const row = viewJobRun(raw as Record<string, unknown>);
    const timeout = timeoutByName.get(row.jobName) ?? 300;
    const started = Date.parse(row.startedAt);
    if (!Number.isFinite(started)) {
      continue;
    }
    if (now.getTime() - started <= (timeout + 30) * 1000) {
      continue;
    }
    await ctx.db
      .updateTable(JOB_RUNS_TABLE)
      .set({
        status: "error",
        message: `timed out after ${timeout}s (process did not finish)`,
        finished_at: now.toISOString(),
        duration_ms: now.getTime() - started,
      })
      .where("id", "=", row.id)
      .where("status", "=", "running")
      .execute();
    count += 1;
  }
  return count;
}

export async function cleanupJobRuns(ctx: AppContext, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - ctx.ast.runtime.jobsRetainDays * 24 * 60 * 60 * 1000).toISOString();
  const result = await ctx.db
    .deleteFrom(JOB_RUNS_TABLE)
    .where("started_at", "<", cutoff)
    .where("status", "!=", "running")
    .executeTakeFirst();
  return Number(result.numDeletedRows ?? 0);
}

export type RunJobOutcome =
  | { status: "ok" | "error"; run: JobRunRow }
  | { status: "skipped"; reason: "in_progress" | "already_ran" | "disabled" };

/**
 * Run a named job. Scheduled calls should pass the slot instant as scheduledFor.
 * If that slot already has a row, the outcome is already_ran.
 */
export async function runJob(ctx: AppContext, name: string, options: RunJobOptions): Promise<RunJobOutcome> {
  const job = (ctx.ast.jobs ?? []).find((item) => item.name === name);
  if (!job) {
    throw new JobNotFoundError(name);
  }
  const dryRun = options.dryRun ?? (options.trigger === "scheduled" ? job.dryRun : false);
  const scheduledFor = options.scheduledFor ?? null;
  const scheduledIso = scheduledFor ? scheduledFor.toISOString() : null;
  const leaseTtl = (job.timeoutSeconds + 30) * 1000;
  const holder = instanceHolder();
  const held = await acquireLease(ctx.db, `job-run:${job.name}`, holder, leaseTtl);
  if (!held) {
    return { status: "skipped", reason: "in_progress" };
  }
  const id = crypto.randomUUID();
  const startedAt = new Date();
  try {
    try {
      await ctx.db
        .insertInto(JOB_RUNS_TABLE)
        .values({
          id,
          job_name: job.name,
          handler: job.handler,
          trigger: options.trigger,
          status: "running",
          dry_run: dryRun ? 1 : 0,
          scheduled_for: scheduledIso,
          started_at: startedAt.toISOString(),
          finished_at: null,
          duration_ms: null,
          message: null,
          log: null,
          data: null,
          actor_id: options.actor?.id ?? null,
        })
        .execute();
    } catch (error) {
      if (scheduledIso && isUniqueConstraint(error)) {
        return { status: "skipped", reason: "already_ran" };
      }
      throw error;
    }

    const pendingLog: string[] = [];
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), job.timeoutSeconds * 1000);
    const jobCtx: JobContext = {
      name: job.name,
      handler: job.handler,
      dryRun,
      trigger: options.trigger,
      scheduledFor,
      actor: options.actor ?? null,
      db: ctx.db,
      mail: ctx.mail,
      ast: ctx.ast,
      projectDir: ctx.projectDir,
      env: process.env,
      signal: controller.signal,
      log(message: string) {
        const line = message.trimEnd();
        pendingLog.push(line);
        console.log(`[bakorin:job ${job.name}] ${line}`);
        void appendLog(ctx.db, id, [line]).catch((error) => {
          console.warn(`[bakorin] failed to append job log for ${job.name}: ${error instanceof Error ? error.message : String(error)}`);
        });
      },
    };

    let result: JobRunResult = { ok: true };
    try {
      const handler = ctx.hooks.jobs?.[job.handler];
      if (!handler) {
        throw new Error(`No hooks.jobs.${job.handler} handler is defined`);
      }
      const returned = await Promise.race([
        Promise.resolve().then(() => handler(jobCtx)),
        new Promise<never>((_, reject) => {
          const abort = () => reject(new Error(`timed out after ${job.timeoutSeconds}s`));
          if (controller.signal.aborted) {
            abort();
            return;
          }
          controller.signal.addEventListener("abort", abort, { once: true });
        }),
      ]);
      if (returned && typeof returned === "object") {
        result = {
          ok: returned.ok !== false,
          ...(returned.message ? { message: returned.message } : {}),
          ...(returned.data !== undefined ? { data: returned.data } : {}),
        };
      }
    } catch (error) {
      result = { ok: false, message: error instanceof Error ? error.message : String(error) };
    } finally {
      clearTimeout(timer);
    }

    const finishedAt = new Date();
    if (pendingLog.length > 0) {
      await appendLog(ctx.db, id, []);
    }
    await ctx.db
      .updateTable(JOB_RUNS_TABLE)
      .set({
        status: result.ok ? "ok" : "error",
        message: result.message ?? null,
        data: serializeData(result.data),
        finished_at: finishedAt.toISOString(),
        duration_ms: finishedAt.getTime() - startedAt.getTime(),
      })
      .where("id", "=", id)
      .execute();
    const run = await getJobRun(ctx.db, id);
    if (!run) {
      throw new Error(`job run ${id} disappeared`);
    }
    return { status: result.ok ? "ok" : "error", run };
  } finally {
    await releaseLease(ctx.db, `job-run:${job.name}`, holder);
  }
}

export class JobNotFoundError extends Error {
  constructor(name: string) {
    super(`job ${name} is not defined in app.yaml`);
    this.name = "JobNotFoundError";
  }
}

export function dueScheduledFor(job: JobAST, now: Date): Date | null {
  const expr = parseCron(job.cron);
  return latestCronOccurrenceAtOrBefore(expr, now, job.timezone);
}

export const JOBS_LAST_TICK_META = "jobs_last_tick";

/**
 * Run any enabled job whose latest cron slot is due after the last tick
 * (or after `since`, when provided) and has not already been recorded.
 * The first tick after a fresh database does not backfill historical slots.
 */
export async function runDueJobs(
  ctx: AppContext,
  now = new Date(),
  options: { since?: Date } = {},
): Promise<RunJobOutcome[]> {
  const outcomes: RunJobOutcome[] = [];
  await sweepStaleJobRuns(ctx, now);
  let since = options.since;
  if (!since) {
    const raw = await metaGet(ctx.db, JOBS_LAST_TICK_META);
    since = raw ? new Date(raw) : now;
  }
  const sinceMs = since.getTime();
  for (const job of ctx.ast.jobs ?? []) {
    if (!job.enabled) {
      continue;
    }
    const scheduledFor = dueScheduledFor(job, now);
    if (!scheduledFor) {
      continue;
    }
    if (scheduledFor.getTime() > now.getTime() || scheduledFor.getTime() <= sinceMs) {
      continue;
    }
    const outcome = await runJob(ctx, job.name, { trigger: "scheduled", scheduledFor, dryRun: job.dryRun });
    outcomes.push(outcome);
  }
  await metaSet(ctx.db, JOBS_LAST_TICK_META, now.toISOString());
  await cleanupJobRuns(ctx, now);
  return outcomes;
}
