import { useEffect, useState } from "preact/hooks";
import { listAudit, type AuditRecord } from "../lib/api.ts";
import { formatDateTime } from "../lib/format.ts";

export function Audit() {
  const [rows, setRows] = useState<AuditRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const limit = 25;

  async function refresh(nextOffset = offset) {
    setError(null);
    const result = await listAudit({ limit, offset: nextOffset });
    setRows(result.data);
    setTotal(result.meta.total);
  }

  useEffect(() => {
    void refresh(0)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "failed to load audit log"))
      .finally(() => setLoading(false));
  }, []);

  return (
    <>
      <div class="toolbar">
        <div>
          <h1>Audit log</h1>
          <div class="muted">Append-only auth events, admin writes, and backups.</div>
        </div>
        <button class="btn secondary" type="button" onClick={() => void refresh(offset)}>
          Refresh
        </button>
      </div>
      {error ? <div class="banner">{error}</div> : null}
      <div class="table-wrap">
        {loading ? (
          <div class="skeleton" aria-hidden="true">
            <div class="skeleton-row" />
            <div class="skeleton-row" />
            <div class="skeleton-row" />
          </div>
        ) : rows.length === 0 ? (
          <div class="empty">
            <h2>No audit events yet</h2>
            <p>Sign-in, writes, and backups will show up here.</p>
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Action</th>
                <th>Actor</th>
                <th>Entity</th>
                <th>Record</th>
                <th>IP</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{formatDateTime(row.at)}</td>
                  <td class="mono">{row.action}</td>
                  <td class="mono">{row.actorId ?? ""}</td>
                  <td>{row.entity ?? ""}</td>
                  <td class="mono">{row.recordId ?? ""}</td>
                  <td class="mono">{row.ip ?? ""}</td>
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
            void refresh(next);
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
            void refresh(next);
          }}
        >
          Next
        </button>
      </div>
    </>
  );
}
