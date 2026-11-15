import { useEffect, useState } from "preact/hooks";
import {
  listWebhookDeliveries,
  listWebhooks,
  retryWebhookDelivery,
  sendWebhookTest,
  type WebhookConfig,
  type WebhookDelivery,
} from "../lib/api.ts";
import { formatDateTime } from "../lib/format.ts";
import { pushToast } from "../lib/toast.ts";

type StatusFilter = "all" | "pending" | "delivered" | "failed";

function statusLabel(status: WebhookDelivery["status"]): string {
  switch (status) {
    case "pending":
      return "Pending";
    case "delivered":
      return "Delivered";
    case "failed":
      return "Failed";
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

export function Webhooks() {
  const [hooks, setHooks] = useState<WebhookConfig[]>([]);
  const [rows, setRows] = useState<WebhookDelivery[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [status, setStatus] = useState<StatusFilter>("all");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const limit = 25;

  async function refresh(nextOffset = offset, nextStatus = status) {
    setError(null);
    const [configured, deliveries] = await Promise.all([
      listWebhooks(),
      listWebhookDeliveries({
        limit,
        offset: nextOffset,
        status: nextStatus,
      }),
    ]);
    setHooks(configured);
    setRows(deliveries.data);
    setTotal(deliveries.meta.total);
  }

  useEffect(() => {
    void refresh(0, status)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "failed to load webhooks"))
      .finally(() => setLoading(false));
  }, []);

  function setFilter(next: StatusFilter) {
    setStatus(next);
    setOffset(0);
    setLoading(true);
    void refresh(0, next)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "failed to load webhooks"))
      .finally(() => setLoading(false));
  }

  async function onRetry(id: string) {
    setBusyId(id);
    try {
      await retryWebhookDelivery(id);
      pushToast("ok", "Delivery queued again");
      await refresh(offset, status);
    } catch (err) {
      setError(err instanceof Error ? err.message : "retry failed");
    } finally {
      setBusyId(null);
    }
  }

  async function onTest(id: string) {
    setBusyId(id);
    try {
      await sendWebhookTest(id);
      pushToast("ok", "Test event sent");
      await refresh(0, status);
      setOffset(0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "test event failed");
    } finally {
      setBusyId(null);
    }
  }

  const filters: StatusFilter[] = ["all", "pending", "delivered", "failed"];

  return (
    <>
      <div class="toolbar">
        <div>
          <h1>Webhooks</h1>
          <div class="muted">Outbound deliveries from this project. Failed rows can be retried.</div>
        </div>
        <button
          class="btn secondary"
          type="button"
          onClick={() => {
            setLoading(true);
            void refresh(offset, status)
              .catch((err: unknown) => setError(err instanceof Error ? err.message : "failed to load webhooks"))
              .finally(() => setLoading(false));
          }}
        >
          Refresh
        </button>
      </div>
      {error ? <div class="banner">{error}</div> : null}

      <section class="hook-list" aria-label="Configured webhooks">
        {hooks.length === 0 ? (
          <div class="empty compact">
            <h2>No webhooks configured</h2>
            <p>Add a webhooks list in app.yaml, then restart the server.</p>
          </div>
        ) : (
          <ul class="hook-cards">
            {hooks.map((hook) => (
              <li key={hook.id} class="hook-card">
                <div>
                  <strong>{hook.entity === "*" ? "All entities" : hook.entity}</strong>
                  <div class="muted">
                    {hook.events.join(", ")} · {hook.urlHost} · {hook.maxAttempts} attempts
                  </div>
                </div>
                <button
                  class="btn secondary"
                  type="button"
                  disabled={busyId === hook.id}
                  onClick={() => void onTest(hook.id)}
                >
                  {busyId === hook.id ? "Sending" : "Send test event"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div class="filters" role="tablist" aria-label="Filter deliveries">
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
            <h2>No deliveries yet</h2>
            <p>
              {hooks.length === 0
                ? "Configure a webhook in app.yaml to start sending events."
                : "Create or update a record, or send a test event."}
            </p>
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Event</th>
                <th>Host</th>
                <th>Status</th>
                <th>Attempts</th>
                <th>Last response</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{formatDateTime(row.createdAt)}</td>
                  <td class="mono">{row.event}</td>
                  <td class="mono">{row.urlHost}</td>
                  <td>
                    <span class={`badge status-${row.status}`}>{statusLabel(row.status)}</span>
                  </td>
                  <td>{row.attempts}</td>
                  <td class="muted">
                    {row.lastStatusCode != null ? row.lastStatusCode : ""}
                    {row.lastError ? ` ${row.lastError}` : ""}
                  </td>
                  <td>
                    {row.status === "failed" ? (
                      <button
                        class="btn secondary"
                        type="button"
                        disabled={busyId === row.id}
                        onClick={() => void onRetry(row.id)}
                      >
                        Retry
                      </button>
                    ) : null}
                  </td>
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
            setLoading(true);
            void refresh(next, status)
              .catch((err: unknown) => setError(err instanceof Error ? err.message : "failed to load webhooks"))
              .finally(() => setLoading(false));
          }}
        >
          Previous
        </button>
        <span>
          {total === 0 ? "0 of 0" : `${offset + 1}-${Math.min(offset + limit, total)} of ${total}`}
        </span>
        <button
          class="btn secondary"
          disabled={offset + limit >= total}
          onClick={() => {
            const next = offset + limit;
            setOffset(next);
            setLoading(true);
            void refresh(next, status)
              .catch((err: unknown) => setError(err instanceof Error ? err.message : "failed to load webhooks"))
              .finally(() => setLoading(false));
          }}
        >
          Next
        </button>
      </div>
    </>
  );
}
