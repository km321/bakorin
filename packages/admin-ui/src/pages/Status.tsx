import { useEffect, useState } from "preact/hooks";
import { ConfirmDialog } from "../components/ConfirmDialog.tsx";
import { actOnDelivery, getStatus, type QueueStats, type StatusReport } from "../lib/api.ts";
import { formatDateTime } from "../lib/format.ts";
import { pushToast } from "../lib/toast.ts";

const REFRESH_MS = 30_000;

export function formatBytes(bytes: number | null): string {
  if (bytes === null) {
    return "Unknown";
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function formatDuration(seconds: number | null): string {
  if (seconds === null) {
    return "None";
  }
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 48) {
    return `${hours}h ${minutes % 60}m`;
  }
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

/** Plain-language problems shown at the top of the page. */
export function statusProblems(report: StatusReport): string[] {
  const problems: string[] = [];
  const failed = report.queues.mail.failed + report.queues.webhooks.failed;
  if (failed > 0) {
    problems.push(`${failed} ${failed === 1 ? "delivery has" : "deliveries have"} failed after all retries. Retry or discard below.`);
  }
  if (report.backups.overdue) {
    problems.push(
      report.backups.lastAt
        ? `The last backup is older than ${report.backups.maxAgeHours} hours.`
        : `No backup has been taken yet. Run one from Backups.`,
    );
  }
  if (report.errors.recent.length > 0) {
    problems.push(`${report.errors.total} server ${report.errors.total === 1 ? "error" : "errors"} since the last start.`);
  }
  return problems;
}

type Pending = { queue: "mail" | "webhooks"; id: string; label: string };

function QueueCard({ title, stats }: { title: string; stats: QueueStats }) {
  return (
    <section class="stat-card" aria-label={`${title} queue`}>
      <h3>{title}</h3>
      <dl class="queue-counts">
        <div>
          <dt>Waiting</dt>
          <dd>{stats.pending + stats.sending}</dd>
        </div>
        <div>
          <dt>Retrying</dt>
          <dd>{stats.retrying}</dd>
        </div>
        <div class={stats.failed > 0 ? "bad" : ""}>
          <dt>Failed</dt>
          <dd>{stats.failed}</dd>
        </div>
        <div>
          <dt>Oldest waiting</dt>
          <dd>{formatDuration(stats.oldestPendingAgeSeconds)}</dd>
        </div>
      </dl>
    </section>
  );
}

function OnOff({ on, children }: { on: boolean; children: string }) {
  return (
    <li>
      <span class={on ? "badge yes" : "badge no"}>{on ? "On" : "Off"}</span> {children}
    </li>
  );
}

export function Status() {
  const [report, setReport] = useState<StatusReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Pending | null>(null);

  async function refresh() {
    try {
      setReport(await getStatus());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to load status");
    }
  }

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), REFRESH_MS);
    return () => clearInterval(timer);
  }, []);

  async function act(queue: "mail" | "webhooks", id: string, action: "retry" | "discard") {
    setBusyId(id);
    try {
      await actOnDelivery(queue, id, action);
      pushToast("ok", action === "retry" ? "Queued again" : "Discarded");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : `${action} failed`);
    } finally {
      setBusyId(null);
    }
  }

  const failedRows = report
    ? [
        ...report.queues.mail.failedItems.map((item) => ({ ...item, queue: "mail" as const })),
        ...report.queues.webhooks.failedItems.map((item) => ({ ...item, queue: "webhooks" as const })),
      ].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    : [];
  const problems = report ? statusProblems(report) : [];

  return (
    <>
      <div class="toolbar">
        <div>
          <h1>Status</h1>
          <div class="muted">Health of this server. Updates every 30 seconds.</div>
        </div>
        <button class="btn secondary" type="button" onClick={() => void refresh()}>
          Refresh
        </button>
      </div>
      {error ? <div class="banner">{error}</div> : null}
      {!report ? (
        <div class="skeleton" aria-hidden="true">
          <div class="skeleton-row" />
          <div class="skeleton-row" />
        </div>
      ) : (
        <>
          {problems.length === 0 ? (
            <div class="banner ok status-banner" role="status">
              Everything looks healthy.
            </div>
          ) : (
            <div class="banner status-banner" role="status">
              <strong>Needs attention</strong>
              <ul class="problem-list">
                {problems.map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </ul>
            </div>
          )}

          <div class="stat-grid">
            <section class="stat-card">
              <h3>Uptime</h3>
              <p class="stat-value">{formatDuration(report.uptimeSeconds)}</p>
              <p class="muted">Since {formatDateTime(report.startedAt)}</p>
            </section>
            <section class="stat-card">
              <h3>Version</h3>
              <p class="stat-value">{report.version}</p>
              <p class="muted mono">{report.commit ? `commit ${report.commit.slice(0, 12)}` : "commit not set"}</p>
            </section>
            <section class="stat-card">
              <h3>Database</h3>
              <p class="stat-value">{report.database.dialect === "postgres" ? "Postgres" : "SQLite"}</p>
              <p class="muted">{formatBytes(report.database.sizeBytes)}</p>
            </section>
            <section class="stat-card">
              <h3>Last backup</h3>
              <p class="stat-value">{report.backups.lastAt ? formatDateTime(report.backups.lastAt) : "None yet"}</p>
              <p class="muted">
                {report.backups.overdue ? (
                  <span class="badge status-failed">Overdue</span>
                ) : report.backups.intervalHours ? (
                  `Every ${report.backups.intervalHours} hours`
                ) : (
                  "No schedule set"
                )}
              </p>
            </section>
          </div>

          {report.realtime?.enabled ? (
            <>
              <h2 class="section-title">Realtime</h2>
              <div class="stat-grid">
                <section class="stat-card" aria-label="Realtime connections">
                  <h3>Open streams</h3>
                  <p class="stat-value">{report.realtime.connections.toLocaleString()}</p>
                  <p class="muted">
                    {report.realtime.users.toLocaleString()} {report.realtime.users === 1 ? "reader" : "readers"}, limit{" "}
                    {report.realtime.maxConnections.toLocaleString()} on this instance
                  </p>
                </section>
                <section class="stat-card" aria-label="Realtime broker">
                  <h3>Broker</h3>
                  <p class="stat-value">{report.realtime.broker === "postgres" ? "Postgres" : "In process"}</p>
                  <p class="muted">
                    {report.realtime.brokerHealthy ? (
                      <span class="badge yes">Connected</span>
                    ) : (
                      <span class="badge status-failed">Not connected</span>
                    )}
                  </p>
                </section>
                <section class="stat-card" aria-label="Realtime events">
                  <h3>Events</h3>
                  <p class="stat-value">{report.realtime.eventsTotal.toLocaleString()}</p>
                  <p class="muted">{report.realtime.deliveriesTotal.toLocaleString()} delivered since start</p>
                </section>
                <section class="stat-card" aria-label="Slow clients">
                  <h3>Slow clients dropped</h3>
                  <p class="stat-value">{report.realtime.droppedSlowTotal.toLocaleString()}</p>
                  <p class="muted">They reconnect and resume on their own</p>
                </section>
              </div>
              <p class="muted realtime-entities">
                Live entities:{" "}
                {report.realtime.entities
                  .map((item) => `${item.name} (${item.mode === "ids" ? "ids only" : "full"}, ${report.realtime!.connectionsByEntity[item.name] ?? 0} open)`)
                  .join(", ")}
              </p>
            </>
          ) : null}

          <h2 class="section-title">Queues</h2>
          <div class="stat-grid two">
            <QueueCard title="Email" stats={report.queues.mail} />
            <QueueCard title="Webhooks" stats={report.queues.webhooks} />
          </div>

          <h2 class="section-title">Failed deliveries</h2>
          <div class="table-wrap">
            {failedRows.length === 0 ? (
              <div class="empty compact">
                <h2>No failed deliveries</h2>
                <p>Email and webhook deliveries that fail after all retries show up here.</p>
              </div>
            ) : (
              <table class="status-table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>What</th>
                    <th>To</th>
                    <th>Last error</th>
                    <th>
                      <span class="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {failedRows.map((row) => (
                    <tr key={`${row.queue}-${row.id}`}>
                      <td>{formatDateTime(row.createdAt)}</td>
                      <td class="label-cell" title={row.label}>
                        {row.label}
                        <div class="muted small">
                          {row.queue === "mail" ? "Email" : "Webhook"}, {row.attempts}{" "}
                          {row.attempts === 1 ? "attempt" : "attempts"}
                        </div>
                      </td>
                      <td class="mono target-cell" title={row.target}>
                        {row.target}
                      </td>
                      <td class="muted wrap">{row.lastError ?? ""}</td>
                      <td class="actions">
                        <div class="row-actions">
                          <button
                            class="btn secondary"
                            type="button"
                            disabled={busyId === row.id}
                            onClick={() => void act(row.queue, row.id, "retry")}
                          >
                            Retry
                          </button>
                          <button
                            class="btn secondary"
                            type="button"
                            disabled={busyId === row.id}
                            onClick={() => setConfirm({ queue: row.queue, id: row.id, label: row.label })}
                          >
                            Discard
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <h2 class="section-title">Recent errors</h2>
          <div class="table-wrap">
            {report.errors.recent.length === 0 ? (
              <div class="empty compact">
                <h2>No errors since the last start</h2>
                <p>Unhandled server errors appear here with their request id.</p>
              </div>
            ) : (
              <table class="status-table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Request</th>
                    <th>Error</th>
                    <th>Request id</th>
                  </tr>
                </thead>
                <tbody>
                  {report.errors.recent.map((item) => (
                    <tr key={`${item.at}-${item.requestId ?? ""}`}>
                      <td>{formatDateTime(item.at)}</td>
                      <td class="mono">{item.method ? `${item.method} ${item.path ?? ""}` : "background"}</td>
                      <td class="wrap">
                        <strong>{item.name}</strong> {item.message}
                      </td>
                      <td class="mono">{item.requestId ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <h2 class="section-title">Monitoring setup</h2>
          <section class="stat-card setup-card">
            <ul class="setup-list">
              <OnOff on={report.logging !== "off"}>
                {report.logging !== "off" ? `Request logs (${report.logging})` : "Request logs (BAKORIN_REQUEST_LOG=json)"}
              </OnOff>
              <OnOff on={report.errors.forwarding.sentry}>Error tracking with Sentry (SENTRY_DSN)</OnOff>
              <OnOff on={report.errors.forwarding.webhook}>Error webhook (ERROR_WEBHOOK_URL)</OnOff>
              <OnOff on={report.alerts.email || report.alerts.webhook}>
                {report.alerts.email || report.alerts.webhook
                  ? `Alerts${report.alerts.email ? " by email" : ""}${report.alerts.webhook ? `${report.alerts.email ? " and" : ""} by webhook` : ""}`
                  : "Alerts (runtime.alerts in app.yaml)"}
              </OnOff>
              <OnOff on={report.metrics}>Prometheus metrics at /metrics (METRICS_TOKEN)</OnOff>
              <OnOff on={Boolean(report.realtime?.enabled)}>Realtime streams (realtime: true on an entity)</OnOff>
              <OnOff on={Boolean(report.mcp?.enabled)}>
                {report.mcp?.enabled
                  ? `MCP dev server at /mcp${report.mcp.tokenConfigured ? " (editor token set)" : " (admin sign in token)"}`
                  : "MCP dev server (runtime.mcp or BAKORIN_MCP)"}
              </OnOff>
            </ul>
          </section>
        </>
      )}
      {confirm ? (
        <ConfirmDialog
          title="Discard this delivery?"
          body={`"${confirm.label}" will not be sent. The record stays in the delivery log as discarded.`}
          confirmLabel="Discard"
          danger
          onClose={() => setConfirm(null)}
          onConfirm={() => {
            const target = confirm;
            setConfirm(null);
            void act(target.queue, target.id, "discard");
          }}
        />
      ) : null}
    </>
  );
}
