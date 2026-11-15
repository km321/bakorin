import type { ComponentChildren } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import {
  deleteRecord,
  getMe,
  getMeta,
  listRecords,
  logout,
  resendVerification,
  type MetaEntity,
  type MetaResponse,
} from "../lib/api.ts";
import { Drawer } from "../components/Drawer.tsx";
import { InviteUser } from "../components/InviteUser.tsx";
import { ConfirmDialog } from "../components/ConfirmDialog.tsx";
import { ThemeToggle } from "../components/ThemeToggle.tsx";
import { IconAudit, IconBackup, IconDocs, IconMenu, IconSchema, IconSearch, IconWebhook } from "../components/Icons.tsx";
import { fieldLabel, relatedLabel } from "../lib/label.ts";
import { emptyLabel, formatDate, formatDateTime, initials } from "../lib/format.ts";
import { pushToast } from "../lib/toast.ts";
import { Backups } from "./Backups.tsx";
import { Audit } from "./Audit.tsx";
import { Webhooks } from "./Webhooks.tsx";
import { Schema } from "./Schema.tsx";

type AdminPage = "records" | "backups" | "audit" | "webhooks" | "schema";

function pageFromHash(hash: string): AdminPage {
  switch (hash) {
    case "#backups":
      return "backups";
    case "#audit":
      return "audit";
    case "#webhooks":
      return "webhooks";
    case "#schema":
      return "schema";
    default:
      return "records";
  }
}

interface Props {
  onLogout: () => void;
  /** Called when the server says this session is no longer an admin (403). */
  onForbidden?: () => void;
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

function cell(row: Record<string, unknown>, field: MetaEntity["fields"][number]): ComponentChildren {
  if (field.relation) {
    return relationCell(row, field.name, field.relation.display);
  }
  const value = row[field.name];
  switch (field.type) {
    case "boolean":
      return <span class={value ? "badge yes" : "badge no"}>{value ? "Yes" : "No"}</span>;
    case "date":
      return formatDate(value);
    case "datetime":
      return formatDateTime(value);
    default:
      if (value === null || value === undefined) {
        return "";
      }
      return String(value);
  }
}

export function AppShell({ onLogout, onForbidden }: Props) {
  const [meta, setMeta] = useState<MetaResponse | null>(null);
  const [me, setMe] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [entityName, setEntityName] = useState<string>("");
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState("-createdAt");
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Record<string, unknown> | null | undefined>(undefined);
  const [inviting, setInviting] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Record<string, unknown> | null>(null);
  const [navOpen, setNavOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const [page, setPage] = useState<AdminPage>(pageFromHash(location.hash));
  const limit = 20;

  const entity: MetaEntity | undefined = useMemo(
    () => meta?.entities.find((item) => item.name === entityName),
    [meta, entityName],
  );

  async function refresh(nextEntity = entityName, nextOffset = offset, nextFilter = filter, nextSort = sort) {
    if (!nextEntity) {
      return;
    }
    setLoading(true);
    const current = meta?.entities.find((item) => item.name === nextEntity);
    const filterField = current?.fields.find((field) => field.type === "text" || field.type === "email");
    const expandFields = (current?.fields ?? [])
      .filter((field) => field.relation)
      .map((field) => field.name)
      .join(",");
    const result = await listRecords(nextEntity, {
      limit,
      offset: nextOffset,
      filter: nextFilter,
      filterField: filterField?.name,
      expand: expandFields || undefined,
      sort: nextSort,
    });
    setRows(result.data);
    setTotal(result.meta.total);
    setLoading(false);
  }

  useEffect(() => {
    void Promise.all([getMeta(), getMe().catch(() => null)])
      .then(([payload, profile]) => {
        setMeta(payload);
        setMe(profile);
        const first = payload.entities[0]?.name ?? "";
        setEntityName(first);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "failed to load");
        if (String(err).includes("forbidden") || String(err).includes("admin")) {
          if (onForbidden) {
            onForbidden();
          } else {
            logout();
            onLogout();
          }
        }
      });
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function pollMeta() {
      try {
        const next = await getMeta();
        if (!cancelled) {
          setMeta((current) => (JSON.stringify(current) === JSON.stringify(next) ? current : next));
        }
      } catch (err) {
        // A 403 means this session lost the admin role: hand back to the gate.
        if (!cancelled && err instanceof Error && err.message === "admin only" && onForbidden) {
          onForbidden();
        }
        // Otherwise keep the last good schema.
      }
    }
    const timer = window.setInterval(() => void pollMeta(), 2500);
    function onFocus() {
      void pollMeta();
    }
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, []);

  useEffect(() => {
    if (!entityName || page !== "records") {
      return;
    }
    const handle = window.setTimeout(() => {
      void refresh(entityName, offset, filter, sort).catch((err: unknown) => {
        setLoading(false);
        setError(err instanceof Error ? err.message : "list failed");
      });
    }, filter ? 250 : 0);
    return () => window.clearTimeout(handle);
  }, [entityName, page, filter, sort, offset, meta]);

  useEffect(() => {
    function onHash() {
      setPage(pageFromHash(location.hash));
    }
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setNavOpen(false);
        setUserOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const columns = (entity?.fields ?? [])
    .filter((field) => !field.secret && field.name !== "id" && field.name !== "createdAt" && field.name !== "updatedAt")
    .slice(0, 6);

  const meLabel =
    (typeof me?.email === "string" && me.email) ||
    (typeof me?.name === "string" && me.name) ||
    "Admin";

  function openEntity(name: string) {
    setOffset(0);
    setFilter("");
    setSort("-createdAt");
    setEntityName(name);
    setPage("records");
    setNavOpen(false);
    if (location.hash) {
      location.hash = "";
    }
  }

  function toggleSort(fieldName: string) {
    setOffset(0);
    setSort((current) => (current === fieldName ? `-${fieldName}` : fieldName));
  }

  return (
    <div class="app-shell">
      {navOpen ? <div class="sidebar-backdrop" onClick={() => setNavOpen(false)} /> : null}
      <aside class={navOpen ? "sidebar open" : "sidebar"} id="app-sidebar">
        <div class="brand">
          <strong>Bakorin</strong>
          <span>{meta?.app.name ?? "loading"}</span>
        </div>
        <nav class="nav" aria-label="Entities">
          <div class="nav-section">Data</div>
          {(meta?.entities ?? []).map((item) => (
            <button
              key={item.name}
              data-nav={item.name}
              class={page === "records" && item.name === entityName ? "active" : ""}
              aria-current={page === "records" && item.name === entityName ? "page" : undefined}
              onClick={() => openEntity(item.name)}
            >
              <span class="nav-mark">{initials(item.plural)}</span>
              {item.plural}
            </button>
          ))}
          <div class="nav-section">Project</div>
          <button
            data-nav="backups"
            class={page === "backups" ? "active" : ""}
            aria-current={page === "backups" ? "page" : undefined}
            onClick={() => {
              setPage("backups");
              location.hash = "backups";
              setNavOpen(false);
            }}
          >
            <span class="nav-icon">
              <IconBackup />
            </span>
            Backups
          </button>
          <button
            data-nav="schema"
            class={page === "schema" ? "active" : ""}
            aria-current={page === "schema" ? "page" : undefined}
            onClick={() => {
              setPage("schema");
              location.hash = "schema";
              setNavOpen(false);
            }}
          >
            <span class="nav-icon">
              <IconSchema />
            </span>
            Schema
          </button>
          <button
            data-nav="webhooks"
            class={page === "webhooks" ? "active" : ""}
            aria-current={page === "webhooks" ? "page" : undefined}
            onClick={() => {
              setPage("webhooks");
              location.hash = "webhooks";
              setNavOpen(false);
            }}
          >
            <span class="nav-icon">
              <IconWebhook />
            </span>
            Webhooks
          </button>
          <button
            data-nav="audit"
            class={page === "audit" ? "active" : ""}
            aria-current={page === "audit" ? "page" : undefined}
            onClick={() => {
              setPage("audit");
              location.hash = "audit";
              setNavOpen(false);
            }}
          >
            <span class="nav-icon">
              <IconAudit />
            </span>
            Audit
          </button>
          <a data-nav="docs" href="/docs" target="_blank" rel="noreferrer">
            <span class="nav-icon">
              <IconDocs />
            </span>
            API docs
          </a>
        </nav>
      </aside>
      <header class="header">
        <div class="header-title">
          <button
            class="menu-btn"
            type="button"
            aria-label="Open navigation"
            aria-controls="app-sidebar"
            aria-expanded={navOpen}
            onClick={() => setNavOpen((open) => !open)}
          >
            <IconMenu />
          </button>
          <strong>{meta?.app.name ?? "Bakorin"}</strong>
        </div>
        <div class="header-actions">
          <ThemeToggle />
          <div class="user-menu">
            <button
              class="user-chip"
              type="button"
              aria-haspopup="menu"
              aria-expanded={userOpen}
              onClick={() => setUserOpen((open) => !open)}
            >
              <span class="nav-mark">{initials(String(meLabel))}</span>
              <span class="user-chip-label">{meLabel}</span>
            </button>
            {userOpen ? (
              <div class="menu-pop" role="menu">
                <p>
                  {meLabel}
                  {typeof me?.role === "string" ? ` · ${me.role}` : ""}
                </p>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    logout();
                    onLogout();
                  }}
                >
                  Sign out
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </header>
      <main class="main">
        {page !== "records" ? (
          <ProjectScreen page={page} meta={meta} onOpenEntity={openEntity} />
        ) : (
          <>
            <div class="toolbar">
              <div>
                <h1>{entity?.plural ?? "Records"}</h1>
                <div class="muted">{total} {total === 1 ? "row" : "rows"}</div>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {meta && entityName === meta.auth.entity ? (
                  <button class="btn secondary" type="button" onClick={() => setInviting(true)}>
                    Invite user
                  </button>
                ) : null}
                <button class="btn" id="bakorin-new" onClick={() => setEditing(null)}>
                  New {entity?.label ?? "record"}
                </button>
              </div>
            </div>
            {error ? <div class="banner">{error}</div> : null}
            <div class="filters">
              <label class="search-field">
                <span class="sr-only">Search</span>
                <IconSearch />
                <input
                  placeholder={`Search ${entity?.plural.toLowerCase() ?? "records"}`}
                  value={filter}
                  onInput={(event) => {
                    setFilter((event.target as HTMLInputElement).value);
                    setOffset(0);
                  }}
                />
              </label>
            </div>
            <div class="table-wrap">
              {loading && rows.length === 0 ? (
                <div class="skeleton" aria-busy="true" aria-label="Loading">
                  <div class="skeleton-row" />
                  <div class="skeleton-row" />
                  <div class="skeleton-row" />
                  <div class="skeleton-row" />
                </div>
              ) : rows.length === 0 ? (
                <div class="empty">
                  <h2>{emptyLabel(entity?.plural ?? "records")}</h2>
                  <p>Create the first {entity?.label.toLowerCase() ?? "record"} to start this list.</p>
                  <button class="btn" type="button" onClick={() => setEditing(null)}>
                    New {entity?.label ?? "record"}
                  </button>
                </div>
              ) : (
                <table>
                  <thead>
                    <tr>
                      {columns.map((field) => {
                        const active = sort === field.name || sort === `-${field.name}`;
                        const dir = sort === `-${field.name}` ? "descending" : sort === field.name ? "ascending" : "none";
                        return (
                          <th key={field.name} class="sortable" aria-sort={dir}>
                            <button type="button" onClick={() => toggleSort(field.name)}>
                              {fieldLabel(field.name)}
                              {active ? (sort.startsWith("-") ? " ↓" : " ↑") : ""}
                            </button>
                          </th>
                        );
                      })}
                      <th>
                        <span class="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={String(row.id)}>
                        {columns.map((field) => (
                          <td key={field.name} class={field.name === "id" ? "mono" : undefined}>
                            {cell(row, field)}
                          </td>
                        ))}
                        <td>
                          <div class="row-actions">
                            <button class="btn secondary" onClick={() => setEditing(row)}>
                              Edit
                            </button>
                            {meta && entityName === meta.auth.entity && row.emailVerified !== true ? (
                              <button
                                class="btn secondary"
                                type="button"
                                onClick={() => {
                                  void resendVerification(String(row.id))
                                    .then(() => {
                                      setError(null);
                                      pushToast("ok", "Verification email sent");
                                    })
                                    .catch((err: unknown) =>
                                      setError(err instanceof Error ? err.message : "resend failed"),
                                    );
                                }}
                              >
                                Resend verification
                              </button>
                            ) : null}
                            <button class="btn danger" onClick={() => setPendingDelete(row)}>
                              Delete
                            </button>
                          </div>
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
                onClick={() => setOffset(Math.max(0, offset - limit))}
              >
                Previous
              </button>
              <span>
                {total === 0 ? "0 of 0" : `${offset + 1}-${Math.min(offset + limit, total)} of ${total}`}
              </span>
              <button
                class="btn secondary"
                disabled={offset + limit >= total}
                onClick={() => setOffset(offset + limit)}
              >
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
      {pendingDelete && entity ? (
        <ConfirmDialog
          title={`Delete this ${entity.label}?`}
          body="This cannot be undone from the admin UI."
          confirmLabel="Delete"
          danger
          onClose={() => setPendingDelete(null)}
          onConfirm={() => {
            const id = String(pendingDelete.id);
            setPendingDelete(null);
            void deleteRecord(entityName, id)
              .then(() => {
                pushToast("ok", `${entity.label} deleted`);
                return refresh();
              })
              .catch((err: unknown) => setError(err instanceof Error ? err.message : "delete failed"));
          }}
        />
      ) : null}
    </div>
  );
}

function ProjectScreen({
  page,
  meta,
  onOpenEntity,
}: {
  page: Exclude<AdminPage, "records">;
  meta: MetaResponse | null;
  onOpenEntity: (name: string) => void;
}) {
  switch (page) {
    case "backups":
      return <Backups />;
    case "webhooks":
      return <Webhooks />;
    case "schema":
      return <Schema initial={meta} onOpenEntity={onOpenEntity} />;
    case "audit":
      return <Audit />;
    default: {
      const exhaustive: never = page;
      return exhaustive;
    }
  }
}
