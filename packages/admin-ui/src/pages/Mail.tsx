/** @jsxImportSource preact */
import { useEffect, useState } from "preact/hooks";
import {
  getMailOverview,
  listMailDeliveries,
  listRelated,
  previewMail,
  retryMailDelivery,
  sendMailTest,
  type MailDelivery,
  type MailDeliveryStatus,
  type MailOverview,
  type MailPreview,
  type MailRuleInfo,
  type MetaResponse,
} from "../lib/api.ts";
import { formatDateTime } from "../lib/format.ts";
import { pushToast } from "../lib/toast.ts";

type StatusFilter = "all" | MailDeliveryStatus;

const STATUS_LABELS: Record<MailDeliveryStatus, string> = {
  pending: "Pending",
  sending: "Sending",
  sent: "Sent",
  failed: "Failed",
  discarded: "Discarded",
};

const SYSTEM_LABELS: Record<string, string> = {
  verify: "Verify email",
  reset: "Password reset",
  invite: "Invite",
};

export function sourceLabel(row: Pick<MailDelivery, "source" | "ruleId" | "purpose">): string {
  if (row.source === "rule") {
    return row.ruleId ?? "rule";
  }
  if (row.source === "auth") {
    return `system: ${row.purpose ?? "auth"}`;
  }
  return row.source;
}

function message(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

export function describeWhen(rule: MailRuleInfo): string {
  const parts = rule.when.map((condition) => {
    switch (condition.op) {
      case "equals":
        return `${condition.field} is ${String(condition.value)}`;
      case "not":
        return `${condition.field} is not ${String(condition.value)}`;
      case "in":
        return `${condition.field} in ${(condition.values ?? []).map(String).join(", ")}`;
      case "notIn":
        return `${condition.field} not in ${(condition.values ?? []).map(String).join(", ")}`;
      case "exists":
        return condition.exists === false ? `${condition.field} is empty` : `${condition.field} is set`;
      default:
        return condition.field;
    }
  });
  if (rule.changed.length > 0) {
    parts.unshift(`${rule.changed.join(" or ")} changed`);
  }
  return parts.join(" and ");
}

interface Selection {
  template: string;
  ruleId: string | null;
  entity: string;
  recordId: string;
}

export function Mail({ meta }: { meta: MetaResponse | null }) {
  const [overview, setOverview] = useState<MailOverview | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [records, setRecords] = useState<Array<Record<string, unknown>>>([]);
  const [preview, setPreview] = useState<MailPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [view, setView] = useState<"html" | "text">("html");
  const [rows, setRows] = useState<MailDelivery[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [status, setStatus] = useState<StatusFilter>("all");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const limit = 25;

  async function refreshDeliveries(nextOffset = offset, nextStatus = status) {
    const deliveries = await listMailDeliveries({ limit, offset: nextOffset, status: nextStatus });
    setRows(deliveries.data);
    setTotal(deliveries.meta.total);
  }

  async function refreshAll() {
    setError(null);
    const [next] = await Promise.all([getMailOverview(), refreshDeliveries(offset, status)]);
    setOverview(next);
    if (!selection) {
      const rule = next.rules[0];
      const template = rule?.template ?? next.templates[0]?.name;
      if (template) {
        choose({ template, ruleId: rule?.id ?? null, entity: rule?.entity ?? "", recordId: "" });
      }
    }
  }

  useEffect(() => {
    void refreshAll()
      .catch((err: unknown) => setError(message(err, "failed to load mail")))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!selection) {
      return;
    }
    let cancelled = false;
    setPreviewError(null);
    void previewMail({
      template: selection.ruleId ? undefined : selection.template,
      ruleId: selection.ruleId ?? undefined,
      entity: selection.entity || undefined,
      recordId: selection.recordId || undefined,
    })
      .then((result) => {
        if (!cancelled) {
          setPreview(result);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setPreview(null);
          setPreviewError(message(err, "preview failed"));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selection?.template, selection?.ruleId, selection?.entity, selection?.recordId]);

  useEffect(() => {
    const entity = selection?.entity;
    if (!entity) {
      setRecords([]);
      return;
    }
    void listRelated(entity).then(setRecords);
  }, [selection?.entity]);

  function choose(next: Selection) {
    setSelection(next);
    setView("html");
  }

  function recordLabel(entityName: string, record: Record<string, unknown>): string {
    const entity = meta?.entities.find((item) => item.name === entityName);
    const display = entity?.display ? record[entity.display] : undefined;
    const id = String(record.id ?? "");
    return display && display !== id ? `${String(display)} (${id.slice(0, 8)})` : id;
  }

  async function onTest() {
    if (!selection) {
      return;
    }
    setBusy("test");
    try {
      const delivery = await sendMailTest({
        template: selection.ruleId ? undefined : selection.template,
        ruleId: selection.ruleId ?? undefined,
        entity: selection.entity || undefined,
        recordId: selection.recordId || undefined,
      });
      if (delivery.status === "sent") {
        pushToast("ok", `Test sent to ${delivery.to.join(", ")}`);
      } else {
        pushToast("error", delivery.lastError ?? `Test ${delivery.status}`);
      }
      setOffset(0);
      await refreshDeliveries(0, status);
    } catch (err) {
      pushToast("error", message(err, "test send failed"));
    } finally {
      setBusy(null);
    }
  }

  async function onRetry(id: string) {
    setBusy(id);
    try {
      await retryMailDelivery(id);
      pushToast("ok", "Delivery queued again");
      await refreshDeliveries(offset, status);
    } catch (err) {
      setError(message(err, "retry failed"));
    } finally {
      setBusy(null);
    }
  }

  function setFilter(next: StatusFilter) {
    setStatus(next);
    setOffset(0);
    void refreshDeliveries(0, next).catch((err: unknown) => setError(message(err, "failed to load deliveries")));
  }

  function page(next: number) {
    setOffset(next);
    void refreshDeliveries(next, status).catch((err: unknown) => setError(message(err, "failed to load deliveries")));
  }

  const rules = overview?.rules ?? [];
  const templates = overview?.templates ?? [];
  const system = overview?.system ?? [];
  const isSystem = selection?.template.startsWith("_auth/") ?? false;
  const entityNames = meta?.entities.map((entity) => entity.name) ?? [];
  const activeRule = rules.find((rule) => rule.id === selection?.ruleId) ?? null;
  const filters: StatusFilter[] = ["all", "pending", "sending", "sent", "failed", "discarded"];

  return (
    <>
      <div class="toolbar">
        <div>
          <h1>Mail</h1>
          <div class="muted">
            Templates in mail/, rules from app.yaml, and every message queued by rules, hooks, or tests.
          </div>
        </div>
        <button
          class="btn secondary"
          type="button"
          onClick={() => {
            setLoading(true);
            void refreshAll()
              .catch((err: unknown) => setError(message(err, "failed to load mail")))
              .finally(() => setLoading(false));
          }}
        >
          Refresh
        </button>
      </div>
      {error ? <div class="banner">{error}</div> : null}
      {overview?.driver === "log" ? (
        <div class="mail-note">
          Driver <span class="mono">log</span>: messages are written to the server log, not delivered. Set{" "}
          <span class="mono">MAIL_DRIVER=resend</span> or <span class="mono">smtp</span> to send for real.
        </div>
      ) : null}

      <div class="mail-layout">
        <aside class="mail-side" aria-label="Templates and rules">
          <h2 class="mail-heading">Rules</h2>
          {rules.length === 0 ? (
            <p class="muted mail-empty">No mail rules in app.yaml yet.</p>
          ) : (
            <ul class="mail-list">
              {rules.map((rule) => (
                <li key={rule.id}>
                  <button
                    type="button"
                    class={selection?.ruleId === rule.id ? "mail-item active" : "mail-item"}
                    aria-pressed={selection?.ruleId === rule.id}
                    onClick={() => choose({ template: rule.template, ruleId: rule.id, entity: rule.entity, recordId: "" })}
                  >
                    <strong>{rule.id}</strong>
                    <span class="muted">
                      {rule.entity} {rule.events.join(", ")} sends {rule.template}
                    </span>
                    {rule.when.length > 0 || rule.changed.length > 0 ? (
                      <span class="muted mail-when">when {describeWhen(rule)}</span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <h2 class="mail-heading">Templates</h2>
          {templates.length === 0 ? (
            <p class="muted mail-empty">Add mail/receipt.html to your project folder.</p>
          ) : (
            <ul class="mail-list">
              {templates.map((template) => (
                <li key={template.name}>
                  <button
                    type="button"
                    class={!selection?.ruleId && selection?.template === template.name ? "mail-item active" : "mail-item"}
                    aria-pressed={!selection?.ruleId && selection?.template === template.name}
                    onClick={() =>
                      choose({
                        template: template.name,
                        ruleId: null,
                        entity: rules.find((rule) => rule.template === template.name)?.entity ?? "",
                        recordId: "",
                      })
                    }
                  >
                    <strong class="mono">{template.name}</strong>
                    <span class="muted">
                      {[template.html ? "html" : "", template.text ? "txt" : "", template.subject ? "subject" : ""]
                        .filter(Boolean)
                        .join(" · ")}
                      {template.rules.length > 0 ? ` · used by ${template.rules.join(", ")}` : ""}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {overview?.layout ? <p class="muted mail-empty">Shared layout: mail/_layout.html</p> : null}
          {system.length > 0 ? (
            <>
              <h2 class="mail-heading">System emails</h2>
              <ul class="mail-list">
                {system.map((item) => {
                  const custom = item.html || item.text || item.subject;
                  const active = selection?.template === item.template;
                  return (
                    <li key={item.kind}>
                      <button
                        type="button"
                        class={active ? "mail-item active" : "mail-item"}
                        aria-pressed={active}
                        onClick={() => choose({ template: item.template, ruleId: null, entity: "", recordId: "" })}
                      >
                        <strong>{SYSTEM_LABELS[item.kind] ?? item.kind}</strong>
                        <span class="muted">
                          {custom ? `custom: mail/${item.template}` : "built in default"} · links hidden in the log
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : null}
        </aside>

        <section class="mail-preview" aria-label="Preview">
          {selection ? (
            <>
              <div class="mail-controls">
                <div class="field">
                  <label for="mail-entity">Entity</label>
                  <select
                    id="mail-entity"
                    value={selection.entity}
                    disabled={Boolean(activeRule) || isSystem}
                    onChange={(event) =>
                      choose({ ...selection, entity: (event.target as HTMLSelectElement).value, recordId: "" })
                    }
                  >
                    <option value="">None</option>
                    {entityNames.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                </div>
                <div class="field">
                  <label for="mail-record">Record</label>
                  <select
                    id="mail-record"
                    value={selection.recordId}
                    disabled={!selection.entity}
                    onChange={(event) => choose({ ...selection, recordId: (event.target as HTMLSelectElement).value })}
                  >
                    <option value="">Sample data</option>
                    {records.map((record) => (
                      <option key={String(record.id)} value={String(record.id)}>
                        {recordLabel(selection.entity, record)}
                      </option>
                    ))}
                  </select>
                </div>
                <button class="btn" type="button" disabled={busy === "test" || !preview} onClick={() => void onTest()}>
                  {busy === "test" ? "Sending" : "Send test to me"}
                </button>
              </div>
              {previewError ? <div class="banner">{previewError}</div> : null}
              {preview ? (
                <div class="mail-message">
                  <dl class="mail-headers">
                    <div>
                      <dt>Subject</dt>
                      <dd>{preview.subject}</dd>
                    </div>
                    {preview.to.length > 0 ? (
                      <div>
                        <dt>To</dt>
                        <dd class="mono">{preview.to.join(", ")}</dd>
                      </div>
                    ) : null}
                    {preview.cc.length > 0 ? (
                      <div>
                        <dt>Cc</dt>
                        <dd class="mono">{preview.cc.join(", ")}</dd>
                      </div>
                    ) : null}
                    <div>
                      <dt>Data</dt>
                      <dd>
                        {isSystem
                          ? "Placeholder link. Real links are never shown here"
                          : preview.sample
                            ? "Sample values"
                            : `Record ${preview.recordId ?? ""}`}
                      </dd>
                    </div>
                  </dl>
                  <div class="filters" role="tablist" aria-label="Preview format">
                    {(["html", "text"] as const).map((item) => (
                      <button
                        key={item}
                        type="button"
                        role="tab"
                        class={view === item ? "filter-chip active" : "filter-chip"}
                        aria-selected={view === item}
                        onClick={() => setView(item)}
                      >
                        {item === "html" ? "HTML" : "Plain text"}
                      </button>
                    ))}
                  </div>
                  {view === "html" ? (
                    <iframe
                      class="mail-frame"
                      title={`Preview of ${preview.template}`}
                      sandbox=""
                      referrerpolicy="no-referrer"
                      src={preview.frameUrl}
                    />
                  ) : (
                    <pre class="mail-text">{preview.text}</pre>
                  )}
                </div>
              ) : null}
            </>
          ) : (
            <div class="empty compact">
              <h2>No templates yet</h2>
              <p>Create mail/receipt.html in the project folder, then press Refresh.</p>
            </div>
          )}
        </section>
      </div>

      <h2 class="mail-heading mail-log-heading">Delivery log</h2>
      <div class="filters" role="tablist" aria-label="Filter deliveries">
        {filters.map((item) => (
          <button
            key={item}
            type="button"
            class={status === item ? "filter-chip active" : "filter-chip"}
            aria-pressed={status === item}
            onClick={() => setFilter(item)}
          >
            {item === "all" ? "All" : STATUS_LABELS[item]}
          </button>
        ))}
      </div>
      <div class="table-wrap">
        {loading ? (
          <div class="skeleton" aria-hidden="true">
            <div class="skeleton-row" />
            <div class="skeleton-row" />
          </div>
        ) : rows.length === 0 ? (
          <div class="empty">
            <h2>No mail yet</h2>
            <p>Messages appear here when a rule matches, a hook calls ctx.mail.send, or you send a test.</p>
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>To</th>
                <th>Subject</th>
                <th>Source</th>
                <th>Status</th>
                <th>Attempts</th>
                <th>Last error</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{formatDateTime(row.createdAt)}</td>
                  <td class="mono">{row.to.join(", ")}</td>
                  <td>{row.subject}</td>
                  <td class="mono">{sourceLabel(row)}</td>
                  <td>
                    <span class={`badge status-${row.status}`}>{STATUS_LABELS[row.status]}</span>
                  </td>
                  <td>
                    {row.attempts}/{row.maxAttempts}
                  </td>
                  <td class="muted">{row.lastError ?? ""}</td>
                  <td>
                    {row.status === "failed" ? (
                      <button
                        class="btn secondary"
                        type="button"
                        disabled={busy === row.id}
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
        <button class="btn secondary" disabled={offset === 0} onClick={() => page(Math.max(0, offset - limit))}>
          Previous
        </button>
        <span>{total === 0 ? "0 of 0" : `${offset + 1}-${Math.min(offset + limit, total)} of ${total}`}</span>
        <button class="btn secondary" disabled={offset + limit >= total} onClick={() => page(offset + limit)}>
          Next
        </button>
      </div>
    </>
  );
}
