/** Periodic tick that claims due cron slots. */

import type { AppContext } from "../context.ts";
import { runDueJobs } from "./runner.ts";

const DEFAULT_TICK_MS = 15_000;

export function jobsTickMs(env: Record<string, string | undefined> = process.env): number {
  const raw = (env.BAKORIN_JOBS_TICK_MS ?? "").trim();
  if (!raw) {
    return DEFAULT_TICK_MS;
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 20) {
    return DEFAULT_TICK_MS;
  }
  return Math.min(value, 60_000);
}

export function startJobsScheduler(ctx: AppContext, env: Record<string, string | undefined> = process.env): () => void {
  const tickMs = jobsTickMs(env);
  let stopped = false;
  let running = false;

  const tick = async () => {
    if (stopped || running) {
      return;
    }
    if ((ctx.ast.jobs ?? []).length === 0) {
      return;
    }
    running = true;
    try {
      await runDueJobs(ctx);
    } catch (error) {
      if (stopped) {
        return;
      }
      console.error(`[bakorin] jobs tick failed: ${error instanceof Error ? error.message : String(error)}`);
      ctx.monitor.captureError(error, { source: "worker" });
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => {
    void tick();
  }, tickMs);
  // Do not keep the process alive only for the timer (tests and short CLI commands).
  timer.unref?.();
  void tick();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
