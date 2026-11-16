import type { ComponentChildren } from "preact";
import { resendVerification, type MetaEntity, type MetaResponse } from "../lib/api.ts";
import { IconSearch } from "../components/Icons.tsx";
import { fieldLabel, relatedLabel } from "../lib/label.ts";
import { emptyLabel, formatDate, formatDateTime } from "../lib/format.ts";
import { pushToast } from "../lib/toast.ts";

function relationCell(row: Record<string, unknown>, fieldName: string, display?: string): string {
  const expand = row.$expand;
  if (expand && typeof expand === "object") {
    const related = (expand as Record<string, unknown>)[fieldName];
    if (Array.isArray(related)) {
      // Many to many: the first few labels, then a count.
      const labels = related.map((item) => relatedLabel(item as Record<string, unknown>, display));
      return labels.length > 3 ? `${labels.slice(0, 3).join(", ")} +${labels.length - 3} more` : labels.join(", ");
    }
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

/** The records screen for one entity: toolbar, search, table, and pager. */
export function RecordsView({
  meta,
  entity,
  entityName,
  rows,
  columns,
  total,
  offset,
  limit,
  filter,
  sort,
  loading,
  error,
  setError,
  setFilter,
  setOffset,
  toggleSort,
  setEditing,
  setInviting,
  setPendingDelete,
}: {
  meta: MetaResponse | null;
  entity: MetaEntity | undefined;
  entityName: string;
  rows: Array<Record<string, unknown>>;
  columns: MetaEntity["fields"];
  total: number;
  offset: number;
  limit: number;
  filter: string;
  sort: string;
  loading: boolean;
  error: string | null;
  setError: (error: string | null) => void;
  setFilter: (filter: string) => void;
  setOffset: (offset: number) => void;
  toggleSort: (fieldName: string) => void;
  setEditing: (record: Record<string, unknown> | null) => void;
  setInviting: (inviting: boolean) => void;
  setPendingDelete: (record: Record<string, unknown>) => void;
}) {
  return (
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
                      if (field.relation?.many) {
                        // Lists of links have no sort order.
                        return <th key={field.name}>{fieldLabel(field.name)}</th>;
                      }
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
  );
}
