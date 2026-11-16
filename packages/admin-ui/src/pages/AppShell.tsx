import { useEffect, useMemo, useState } from "preact/hooks";
import { deleteRecord, getMe, getMeta, getRecord, listRecords, logout, type MetaEntity, type MetaResponse } from "../lib/api.ts";
import { AppHeader } from "../components/AppHeader.tsx";
import { ConfirmDialog } from "../components/ConfirmDialog.tsx";
import { Drawer } from "../components/Drawer.tsx";
import { InviteUser } from "../components/InviteUser.tsx";
import { Sidebar } from "../components/Sidebar.tsx";
import { pushToast } from "../lib/toast.ts";
import { pageFromHash, ProjectScreen, type AdminPage } from "./ProjectScreen.tsx";
import { RecordsView } from "./RecordsView.tsx";

interface Props {
  onLogout: () => void;
  /** Called when the server says this session is no longer an admin (403). */
  onForbidden?: () => void;
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

  /** #record/<entity>/<id> (links from the Files page) opens that record's editor. */
  function openRecordFromHash(hash: string, known: MetaResponse | null = meta): boolean {
    const match = /^#record\/([^/]+)\/(.+)$/.exec(hash);
    if (!match) {
      return false;
    }
    const target = decodeURIComponent(match[1]!);
    const id = decodeURIComponent(match[2]!);
    history.replaceState(null, "", `${location.pathname}${location.search}`);
    if (known && !known.entities.some((item) => item.name === target)) {
      return false;
    }
    setOffset(0);
    setFilter("");
    setSort("-createdAt");
    setEntityName(target);
    setPage("records");
    void getRecord(target, id)
      .then((row) => setEditing(row))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "record not found"));
    return true;
  }

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
      .filter((field) => field.relation || field.type === "file")
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
        openRecordFromHash(location.hash, payload);
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
      if (!openRecordFromHash(location.hash)) {
        setPage(pageFromHash(location.hash));
      }
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
      <Sidebar
        appName={meta?.app.name}
        entities={meta?.entities ?? []}
        page={page}
        entityName={entityName}
        open={navOpen}
        onOpenEntity={openEntity}
        onOpenPage={(next) => {
          setPage(next);
          location.hash = next;
          setNavOpen(false);
        }}
      />
      <AppHeader
        appName={meta?.app.name}
        navOpen={navOpen}
        onToggleNav={() => setNavOpen((open) => !open)}
        meLabel={meLabel}
        role={me?.role}
        userOpen={userOpen}
        onToggleUser={() => setUserOpen((open) => !open)}
        onSignOut={() => {
          logout();
          onLogout();
        }}
      />
      <main class="main">
        {page !== "records" ? (
          <ProjectScreen page={page} meta={meta} onOpenEntity={openEntity} />
        ) : (
          <RecordsView
            meta={meta}
            entity={entity}
            entityName={entityName}
            rows={rows}
            columns={columns}
            total={total}
            offset={offset}
            limit={limit}
            filter={filter}
            sort={sort}
            loading={loading}
            error={error}
            setError={setError}
            setFilter={setFilter}
            setOffset={setOffset}
            toggleSort={toggleSort}
            setEditing={setEditing}
            setInviting={setInviting}
            setPendingDelete={setPendingDelete}
          />
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
