import { useEffect, useMemo, useState } from "preact/hooks";
import { deleteRecord, getMeta, listRecords, logout, resendVerification, type MetaEntity, type MetaResponse } from "../lib/api.ts";
import { Drawer } from "../components/Drawer.tsx";
import { InviteUser } from "../components/InviteUser.tsx";
import { fieldLabel, relatedLabel } from "../lib/label.ts";
import { Backups } from "./Backups.tsx";
import { Audit } from "./Audit.tsx";

interface Props {
  onLogout: () => void;
}

function cell(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "boolean") {
    return value ? "yes" : "no";
  }
  return String(value);
}

function relationCell(row: Record<string, unknown>, fieldName: string, display?: string): string {
  const expand = row.$expand;
  if (expand && typeof expand === "object") {
    const related = (expand as Record<string, unknown>)[fieldName];
    if (related && typeof related === "object") {
      return relatedLabel(related as Record<string, unknown>, display);
    }
  }
  return "";
}

export function AppShell({ onLogout }: Props) {
  const [meta, setMeta] = useState<MetaResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [entityName, setEntityName] = useState<string>("");
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [filter, setFilter] = useState("");
  const [editing, setEditing] = useState<Record<string, unknown> | null | undefined>(undefined);
  const [inviting, setInviting] = useState(false);
  const [page, setPage] = useState<"records" | "backups" | "audit">(
    location.hash === "#backups" ? "backups" : location.hash === "#audit" ? "audit" : "records",
  );
  const limit = 20;

  const entity: MetaEntity | undefined = useMemo(
    () => meta?.entities.find((item) => item.name === entityName),
    [meta, entityName],
  );

  async function refresh(nextEntity = entityName, nextOffset = offset, nextFilter = filter) {
    if (!nextEntity) {
      return;
    }
    const filterField = meta?.entities.find((item) => item.name === nextEntity)?.fields.find((field) => field.type === "text" || field.type === "email");
    const expandFields = (meta?.entities.find((item) => item.name === nextEntity)?.fields ?? [])
      .filter((field) => field.relation)
      .map((field) => field.name)
      .join(",");
    const result = await listRecords(nextEntity, {
      limit,
      offset: nextOffset,
      filter: nextFilter,
      filterField: filterField?.name,
      expand: expandFields || undefined,
    });
    setRows(result.data);
    setTotal(result.meta.total);
  }

  useEffect(() => {
    void getMeta()
      .then((payload) => {
        setMeta(payload);
        const first = payload.entities[0]?.name ?? "";
        setEntityName(first);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "failed to load");
        if (String(err).includes("forbidden") || String(err).includes("admin")) {
          logout();
          onLogout();
        }
      });
  }, []);

  useEffect(() => {
    if (entityName && page === "records") {
      void refresh(entityName, 0, filter).catch((err: unknown) => setError(err instanceof Error ? err.message : "list failed"));
    }
  }, [entityName, page]);

  useEffect(() => {
    function onHash() {
      setPage(location.hash === "#backups" ? "backups" : location.hash === "#audit" ? "audit" : "records");
    }
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const columns = (entity?.fields ?? [])
    .filter((field) => !field.secret && field.name !== "id" && field.name !== "createdAt" && field.name !== "updatedAt")
    .slice(0, 6);

  return (
    <div class="app-shell">
      <aside class="sidebar">
        <div class="brand">
          <strong>Bakorin</strong>
          <span>{meta?.app.name ?? "loading"}</span>
        </div>
        <nav class="nav">
          {(meta?.entities ?? []).map((item) => (
            <button
              key={item.name}
              data-nav={item.name}
              class={page === "records" && item.name === entityName ? "active" : ""}
              onClick={() => {
                setOffset(0);
                setEntityName(item.name);
                setPage("records");
                if (location.hash) {
                  location.hash = "";
                }
              }}
            >
              {item.plural}
            </button>
          ))}
          <button
            data-nav="backups"
            class={page === "backups" ? "active" : ""}
            onClick={() => {
              setPage("backups");
              location.hash = "backups";
            }}
          >
            Backups
          </button>
          <button
            data-nav="audit"
            class={page === "audit" ? "active" : ""}
            onClick={() => {
              setPage("audit");
              location.hash = "audit";
            }}
          >
            Audit
          </button>
          <a data-nav="docs" href="/docs" target="_blank" rel="noreferrer">
            API docs
          </a>
        </nav>
        <button
          class="btn secondary"
          onClick={() => {
            logout();
            onLogout();
          }}
        >
          Sign out
        </button>
      </aside>
      <main class="main">
        {page === "backups" ? (
          <Backups />
        ) : page === "audit" ? (
          <Audit />
        ) : (
          <>
        <div class="toolbar">
          <div>
            <h1>{entity?.plural ?? "Records"}</h1>
            <div class="muted">{total} rows</div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {meta && entityName === meta.auth.entity ? (
              <button class="btn secondary" type="button" onClick={() => setInviting(true)}>
                Invite user
              </button>
            ) : null}
            <button class="btn" id="bakorin-new" onClick={() => setEditing(null)}>
              New
            </button>
          </div>
        </div>
        {error ? <div class="banner">{error}</div> : null}
        <div class="filters">
          <input
            placeholder="Filter"
            value={filter}
            onInput={(event) => setFilter((event.target as HTMLInputElement).value)}
          />
          <button
            class="btn secondary"
            onClick={() => {
              setOffset(0);
              void refresh(entityName, 0, filter);
            }}
          >
            Apply
          </button>
        </div>
        <div class="table-wrap">
          {rows.length === 0 ? (
            <div class="empty">No rows yet. Create one to populate this table.</div>
          ) : (
            <table>
              <thead>
                <tr>
                  {columns.map((field) => (
                    <th key={field.name}>{fieldLabel(field.name)}</th>
                  ))}
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={String(row.id)}>
                    {columns.map((field) => (
                      <td key={field.name} class={field.name === "id" ? "mono" : undefined}>
                        {field.relation ? relationCell(row, field.name, field.relation.display) : cell(row[field.name])}
                      </td>
                    ))}
                    <td>
                      <button class="btn secondary" onClick={() => setEditing(row)}>
                        Edit
                      </button>{" "}
                      {meta && entityName === meta.auth.entity && row.emailVerified !== true ? (
                        <>
                          <button
                            class="btn secondary"
                            type="button"
                            onClick={() => {
                              void resendVerification(String(row.id))
                                .then(() => setError(null))
                                .catch((err: unknown) => setError(err instanceof Error ? err.message : "resend failed"));
                            }}
                          >
                            Resend verification
                          </button>{" "}
                        </>
                      ) : null}
                      <button
                        class="btn danger"
                        onClick={() => {
                          if (confirm("Delete this row?")) {
                            void deleteRecord(entityName, String(row.id)).then(() => refresh());
                          }
                        }}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div class="pager">
          <button class="btn secondary" disabled={offset === 0} onClick={() => {
            const next = Math.max(0, offset - limit);
            setOffset(next);
            void refresh(entityName, next, filter);
          }}>
            Previous
          </button>
          <span>
            {offset + 1}-{Math.min(offset + limit, total)} of {total}
          </span>
          <button class="btn secondary" disabled={offset + limit >= total} onClick={() => {
            const next = offset + limit;
            setOffset(next);
            void refresh(entityName, next, filter);
          }}>
            Next
          </button>
        </div>
          </>
        )}
      </main>
      {entity && editing !== undefined ? (
        <Drawer
          entity={entity}
          record={editing}
          onClose={() => setEditing(undefined)}
          onSaved={() => {
            setEditing(undefined);
            void refresh();
          }}
        />
      ) : null}
      {meta && inviting ? (
        <InviteUser
          meta={meta}
          onClose={() => setInviting(false)}
          onInvited={() => {
            setInviting(false);
            void refresh();
          }}
        />
      ) : null}
    </div>
  );
}
