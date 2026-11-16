/** bakorin jobs list and bakorin jobs run <name> [--dry-run]. */

import { hasFlag, projectDir } from "./cli-args.ts";
import { loadOrExit } from "./cli-serve.ts";
import { JobNotFoundError, runJob } from "./jobs/runner.ts";

export async function cmdJobs(): Promise<void> {
  const sub = process.argv[3];
  const dir = projectDir();
  if (sub === "list") {
    const runtime = await loadOrExit(dir, { workers: false });
    try {
      const jobs = runtime.ast.jobs ?? [];
      if (jobs.length === 0) {
        console.log("No jobs are defined in app.yaml.");
        return;
      }
      for (const job of jobs) {
        const flags = [
          job.enabled ? "enabled" : "disabled",
          job.dryRun ? "dry-run" : "",
          job.timezone,
        ].filter(Boolean);
        console.log(`${job.name}  ${job.cron}  handler=${job.handler}  (${flags.join(", ")})`);
      }
    } finally {
      await runtime.close();
    }
    return;
  }
  const name = process.argv[4];
  if (sub !== "run" || !name || name.startsWith("-")) {
    console.error("usage: bakorin jobs list");
    console.error("       bakorin jobs run <name> [--dry-run]");
    process.exit(1);
  }
  const runtime = await loadOrExit(dir, { workers: false });
  const dry = hasFlag("--dry-run");
  try {
    const outcome = await runJob(runtime.context, name, { trigger: "manual", dryRun: dry || undefined });
    if (outcome.status === "skipped") {
      console.error(outcome.reason === "in_progress" ? "that job is already running" : "that scheduled slot already ran");
      process.exit(1);
    }
    const run = outcome.run;
    const suffix = run.message ? `  ${run.message}` : "";
    console.log(`${run.jobName}  ${run.status}${run.dryRun ? "  dry-run" : ""}${suffix}`);
    if (run.log) {
      console.log(run.log);
    }
    if (outcome.status === "error") {
      process.exit(1);
    }
  } catch (error) {
    if (error instanceof JobNotFoundError) {
      console.error(error.message);
      await runtime.close();
      process.exit(1);
    }
    await runtime.close();
    throw error;
  }
  await runtime.close();
}
