import { useEffect, useState } from "preact/hooks";
import { listJobRuns, listJobs, runJobNow, type JobConfig, type JobRun, type JobRunStatus } from "../lib/api.ts";
import { formatDateTime } from "../lib/format.ts";
import { pushToast } from "../lib/toast.ts";

type StatusFilter = "all" | JobRunStatus;

function statusLabel(status: JobRunStatus): string {
  switch (status) {
    case "ok":
      return "OK";
    case "error":
      return "Error";
    case "running":
      return "Running";
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

function triggerLabel(trigger: JobRun["trigger"]): string {
  return trigger === "manual" ? "Manual" : "Scheduled";
}

function formatDuration(ms: number | null): string {
  if (ms == null) {
    return "";
  }
  if (ms < 1000) {
    return `${ms} ms`;
  }
  const seconds = ms / 1000;
  if (seconds < 60) {
    return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${minutes}m ${rest}s`;
}

export function Jobs() {
  const [jobs, setJobs] = useState<JobConfig[]>([]);
  const [rows, setRows] = useState<JobRun[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [status, setStatus] = useState<StatusFilter>("all");
  const [jobFilter, setJobFilter] = useState("all");
  const [dryRunByName, setDryRunByName] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyName, setBusyName] = useState<string | null>(null);
  const limit = 25;

  async function refresh(nextOffset = offset, nextStatus = status, nextJob = jobFilter) {
    setError(null);
    const [configured, runs] = await Promise.all([
      listJobs(),
      listJobRuns({
        limit,
        offset: nextOffset,
        status: nextStatus,
        job: nextJob === "all" ? undefined : nextJob,
      }),
    ]);
    setJobs(configured);
    setRows(runs.data);
    setTotal(runs.meta.total);
    setDryRunByName((current) => {
      const next = { ...current };
      for (const job of configured) {
        if (next[job.name] === undefined) {
          next[job.name] = job.dryRun;
        }
      }
      return next;
    });
  }

  useEffect(() => {
    void refresh(0, status, jobFilter)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "failed to load jobs"))
      .finally(() => setLoading(false));
  }, []);

  function reload(nextOffset: number, nextStatus: StatusFilter, nextJob: string) {
    setLoading(true);
    void refresh(nextOffset, nextStatus, nextJob)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "failed to load jobs"))
      .finally(() => setLoading(false));
  }

  function setFilter(next: StatusFilter) {
    setStatus(next);
    setOffset(0);
    reload(0, next, jobFilter);
  }

  function setJob(next: string) {
    setJobFilter(next);
    setOffset(0);
    reload(0, status, next);
  }

  async function onRun(name: string) {
    setBusyName(name);
    try {
      const run = await runJobNow(name, dryRunByName[name] ?? false);
      if (run.status === "ok") {
        pushToast("ok", run.dryRun ? `${name} finished (dry run)` : `${name} finished`);
      } else {
        pushToast("error", run.message ? `${name} failed: ${run.message}` : `${name} failed`);
      }
      setOffset(0);
      await refresh(0, status, jobFilter);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to run job");
    } finally {
      setBusyName(null);
    }
  }

  const filters: StatusFilter[] = ["all", "ok", "error", "running"];

  return (
    <>
      <div class="toolbar">
        <div>
          <h1>Jobs</h1>
          <div class="muted">Scheduled jobs from app.yaml. Run one now, or review recent history.</div>
        </div>
        <button class="btn secondary" type="button" onClick={() => reload(offset, status, jobFilter)}>
          Refresh
        </button>
      </div>
      {error ? <div class="banner">{error}</div> : null}

      <section class="hook-list" aria-label="Configured jobs">
        {jobs.length === 0 ? (
          <div class="empty compact">
            <h2>No jobs configured</h2>
            <p>Add a jobs list in app.yaml and a matching hooks.jobs handler, then restart the server.</p>
          </div>
        ) : (
          <ul class="hook-cards">
            {jobs.map((job) => (
              <li key={job.name} class="hook-card">
                <div>
                  <strong>
                    {job.name}
                    {job.enabled ? "" : " (disabled)"}
                  </strong>
                  <div class="muted">
                    {job.cron} · {job.timezone} · {job.handler}
                    {job.lastRun
                      ? ` · last ${statusLabel(job.lastRun.status).toLowerCase()} ${formatDateTime(job.lastRun.startedAt)}`
                      : " · no runs yet"}
                  </div>
                </div>
                <div class="hook-card-actions">
                  <label class="inline-check">
                    <input
                      type="checkbox"
                      checked={dryRunByName[job.name] ?? job.dryRun}
                      onChange={(event) => {
                        const checked = (event.target as HTMLInputElement).checked;
                        setDryRunByName((current) => ({ ...current, [job.name]: checked }));
                      }}
                    />
                    Dry run
                  </label>
                  <button
                    class="btn secondary"
                    type="button"
                    disabled={busyName === job.name}
                    onClick={() => void onRun(job.name)}
                  >
                    {busyName === job.name ? "Running" : "Run now"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div class="filters" role="tablist" aria-label="Filter runs">
        {filters.map((item) => (
          <button
            key={item}
            type="button"
            class={status === item ? "filter-chip active" : "filter-chip"}
            aria-pressed={status === item}
            onClick={() => setFilter(item)}
          >
            {item === "all" ? "All" : statusLabel(item)}
          </button>
        ))}
        {jobs.length > 0 ? (
          <label class="filter-select">
            <span class="sr-only">Job</span>
            <select value={jobFilter} onChange={(event) => setJob((event.target as HTMLSelectElement).value)}>
              <option value="all">All jobs</option>
              {jobs.map((job) => (
                <option key={job.name} value={job.name}>
                  {job.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      <div class="table-wrap">
        {loading ? (
          <div class="skeleton" aria-hidden="true">
            <div class="skeleton-row" />
            <div class="skeleton-row" />
            <div class="skeleton-row" />
          </div>
        ) : rows.length === 0 ? (
          <div class="empty">
            <h2>No runs yet</h2>
            <p>
              {jobs.length === 0
                ? "Configure a job in app.yaml to start a schedule."
                : "Wait for the next scheduled slot, or run a job now."}
            </p>
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Job</th>
                <th>Trigger</th>
                <th>Status</th>
                <th>Duration</th>
                <th>Message</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{formatDateTime(row.startedAt)}</td>
                  <td class="mono">
                    {row.jobName}
                    {row.dryRun ? " (dry run)" : ""}
                  </td>
                  <td>{triggerLabel(row.trigger)}</td>
                  <td>
                    <span class={`badge status-${row.status}`}>{statusLabel(row.status)}</span>
                  </td>
                  <td>{formatDuration(row.durationMs)}</td>
                  <td class="muted">{row.message ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div class="pager">
        <button
          class="btn secondary"
          disabled={offset === 0}
          onClick={() => {
            const next = Math.max(0, offset - limit);
            setOffset(next);
            reload(next, status, jobFilter);
          }}
        >
          Previous
        </button>
        <span>{total === 0 ? "0 of 0" : `${offset + 1}-${Math.min(offset + limit, total)} of ${total}`}</span>
        <button
          class="btn secondary"
          disabled={offset + limit >= total}
          onClick={() => {
            const next = offset + limit;
            setOffset(next);
            reload(next, status, jobFilter);
          }}
        >
          Next
        </button>
      </div>
    </>
  );
}
