/** Compile the top-level jobs: list in app.yaml. */

import { JOB_DEFAULT_TIMEOUT_SECONDS, type JobAST } from "./ast.ts";
import { CronError, isValidTimeZone, parseCron } from "./cron.ts";
import { SchemaError } from "./errors.ts";
import { isIdent } from "./ident.ts";
import type { AppYaml } from "./yaml-schema.ts";

export function compileJobs(doc: AppYaml): JobAST[] {
  const raw = doc.jobs ?? [];
  const jobs: JobAST[] = [];
  const seen = new Set<string>();
  raw.forEach((item, index) => {
    const label = item.name ? `job "${item.name}"` : `job #${index + 1}`;
    const name = (item.name ?? "").trim();
    if (!isIdent(name)) {
      throw new SchemaError(`${label}: name must be a letter or underscore, then letters, digits, or underscores`);
    }
    if (seen.has(name)) {
      throw new SchemaError(`${label}: duplicate job name`);
    }
    seen.add(name);

    const handlerRaw = (item.handler ?? "").trim();
    const handler = handlerRaw || name;
    if (!isIdent(handler)) {
      throw new SchemaError(`${label}: handler must be a letter or underscore, then letters, digits, or underscores`);
    }

    const cronSrc = (item.cron ?? "").trim();
    if (!cronSrc) {
      throw new SchemaError(`${label}: cron is required`);
    }
    try {
      parseCron(cronSrc);
    } catch (error) {
      const message = error instanceof CronError ? error.message : String(error);
      throw new SchemaError(`${label}: ${message}`);
    }

    const timezone = (item.timezone ?? "UTC").trim() || "UTC";
    if (!isValidTimeZone(timezone)) {
      throw new SchemaError(`${label}: timezone ${JSON.stringify(timezone)} is not a valid IANA time zone`);
    }

    const timeoutSeconds = item.timeoutSeconds ?? JOB_DEFAULT_TIMEOUT_SECONDS;
    if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 1 || timeoutSeconds > 86_400) {
      throw new SchemaError(`${label}: timeoutSeconds must be an integer from 1 to 86400`);
    }

    jobs.push({
      name,
      cron: cronSrc,
      handler,
      timezone,
      dryRun: item.dryRun ?? false,
      timeoutSeconds,
      enabled: item.enabled ?? true,
    });
  });
  return jobs;
}
