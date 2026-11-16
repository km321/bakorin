/** Admin API for cron jobs: list, run history, and run now. */

import { Hono } from "hono";
import { requireAdmin } from "../auth/guard.ts";
import { JobNotFoundError, getJobRun, lastRunsByJob, listJobRuns, runJob, type JobRunStatus } from "./runner.ts";

function parseStatus(raw: string | null): JobRunStatus | undefined {
  if (raw === "ok" || raw === "error" || raw === "running") {
    return raw;
  }
  return undefined;
}

export function createJobRoutes(): Hono {
  const app = new Hono();

  app.get("/", async (c) => {
    const denied = requireAdmin(c);
    if (denied) {
      return denied;
    }
    const ctx = c.get("app");
    const jobs = ctx.ast.jobs ?? [];
    const last = await lastRunsByJob(ctx.db, jobs.map((job) => job.name));
    return c.json({
      data: jobs.map((job) => ({
        name: job.name,
        cron: job.cron,
        handler: job.handler,
        timezone: job.timezone,
        dryRun: job.dryRun,
        timeoutSeconds: job.timeoutSeconds,
        enabled: job.enabled,
        lastRun: last[job.name] ?? null,
      })),
    });
  });

  app.get("/runs", async (c) => {
    const denied = requireAdmin(c);
    if (denied) {
      return denied;
    }
    const ctx = c.get("app");
    const url = new URL(c.req.url);
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") ?? 50) || 50));
    const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0) || 0);
    const job = url.searchParams.get("job")?.trim() || undefined;
    const status = parseStatus(url.searchParams.get("status"));
    const result = await listJobRuns(ctx.db, { job, status, limit, offset });
    return c.json({ data: result.data, meta: { total: result.total, limit, offset } });
  });

  app.post("/:name/run", async (c) => {
    const denied = requireAdmin(c);
    if (denied) {
      return denied;
    }
    const ctx = c.get("app");
    const name = c.req.param("name");
    let dryRun: boolean | undefined;
    try {
      const body = (await c.req.json()) as { dryRun?: unknown };
      if (typeof body.dryRun === "boolean") {
        dryRun = body.dryRun;
      }
    } catch {
      dryRun = undefined;
    }
    try {
      const outcome = await runJob(ctx, name, {
        trigger: "manual",
        actor: c.get("actor"),
        ...(dryRun !== undefined ? { dryRun } : {}),
      });
      if (outcome.status === "skipped") {
        const message =
          outcome.reason === "in_progress"
            ? "that job is already running"
            : "that scheduled slot already ran";
        return c.json({ error: { code: "conflict", message } }, 409);
      }
      return c.json({ data: outcome.run }, outcome.status === "ok" ? 201 : 200);
    } catch (error) {
      if (error instanceof JobNotFoundError) {
        return c.json({ error: { code: "not_found", message: error.message } }, 404);
      }
      throw error;
    }
  });

  app.get("/runs/:id", async (c) => {
    const denied = requireAdmin(c);
    if (denied) {
      return denied;
    }
    const row = await getJobRun(c.get("app").db, c.req.param("id"));
    if (!row) {
      return c.json({ error: { code: "not_found", message: "job run not found" } }, 404);
    }
    return c.json({ data: row });
  });

  return app;
}
