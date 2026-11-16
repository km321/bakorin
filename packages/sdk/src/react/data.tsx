/** @jsxImportSource react */
import { useId, type ReactNode } from "react";
import { formatValue } from "../headless/format.ts";
import { columnFields, fieldLabel, type EntitySchema, type FieldSchema } from "../headless/schema.ts";
import { useBakorin } from "./context.tsx";
import { FormAlert, cx } from "./field.tsx";
import { useCollection, type UseCollectionOptions } from "./hooks.ts";

type Row = object;
const field = (row: object, name: string): unknown => (row as Record<string, unknown>)[name];
export type CollectionHandle<T extends Row = Row> = ReturnType<typeof useCollection<T>>;

export interface Column<T extends Row = Row> {
  field: string;
  label?: string;
  /** Allow sorting by this column. Default true for schema fields. */
  sortable?: boolean;
  render?: (row: T) => ReactNode;
}

export interface DataTableProps<T extends Row = Row> extends UseCollectionOptions<T> {
  entity: string;
  /** Field names or column definitions. Default: readable schema fields. */
  columns?: (string | Column<T>)[];
  /** A caption names the table for screen readers. Default: the entity name. */
  caption?: string;
  /** Hide the caption visually but keep it for screen readers. */
  hideCaption?: boolean;
  /** Boolean fields shown as checkboxes that save on change. */
  toggle?: string[];
  /** Adds a Delete button to each row. */
  deletable?: boolean;
  /** Asked before deleting. Set to null to skip. */
  confirmDelete?: string | null;
  /** Extra cells at the end of each row (edit links, buttons). */
  actions?: (row: T, collection: CollectionHandle<T>) => ReactNode;
  emptyText?: string;
  /** Share a collection with a RecordForm so new rows show at once. */
  collection?: CollectionHandle<T>;
  className?: string;
}

function resolveColumns<T extends Row>(schema: EntitySchema | undefined, columns: (string | Column<T>)[] | undefined): (Column<T> & { meta?: FieldSchema })[] {
  if (!columns) {
    return schema ? columnFields(schema).map((meta) => ({ field: meta.name, meta, sortable: true })) : [{ field: "id" }];
  }
  return columns.map((column) => {
    const resolved = typeof column === "string" ? { field: column } : column;
    const meta = schema?.fields.find((field) => field.name === resolved.field);
    return { sortable: Boolean(meta), ...resolved, meta };
  });
}

function rowName(row: Row, schema: EntitySchema | undefined): string {
  return String(field(row, schema?.display ?? "id") ?? field(row, "id") ?? "row");
}

/** Pagination controls with a live summary. */
export function Pager({ collection, label }: { collection: CollectionHandle; label: string }) {
  const { page, total } = collection;
  return (
    <nav className="bk-pager" aria-label={`${label} pages`}>
      <button className="bk-button bk-button--secondary bk-button--small" type="button" disabled={!page.hasPrevious || collection.loading} onClick={() => void collection.previous()}>
        Previous
      </button>
      <span className="bk-pager__status" aria-live="polite">
        {total === 0 ? "No rows" : `${page.from} to ${page.to} of ${total}`}
      </span>
      <button className="bk-button bk-button--secondary bk-button--small" type="button" disabled={!page.hasNext || collection.loading} onClick={() => void collection.next()}>
        Next
      </button>
    </nav>
  );
}

function OwnCollection<T extends Row>(props: DataTableProps<T> & { view: (collection: CollectionHandle<T>) => ReactNode }) {
  const collection = useCollection<T>(props.entity, props);
  return <>{props.view(collection)}</>;
}

/** A paged, sortable table for an entity, with optional toggles and delete. */
export function DataTable<T extends Row = Row>(props: DataTableProps<T>) {
  const view = (collection: CollectionHandle<T>) => <DataTableView {...props} collection={collection} />;
  return props.collection ? view(props.collection) : <OwnCollection {...props} view={view} />;
}

function DataTableView<T extends Row>(props: DataTableProps<T> & { collection: CollectionHandle<T> }) {
  const { schema } = useBakorin();
  const entitySchema = schema?.entities[props.entity];
  const { collection } = props;
  const columns = resolveColumns(entitySchema, props.columns);
  const captionId = useId();
  const caption = props.caption ?? fieldLabel(props.entity);
  const confirmText = props.confirmDelete === undefined ? "Delete this row?" : props.confirmDelete;
  const sortDirection = (field: string) =>
    collection.sort === field ? "ascending" : collection.sort === `-${field}` ? "descending" : undefined;

  return (
    <div className={cx("bk-table-wrap", props.className)}>
      <FormAlert message={collection.error} />
      <table className="bk-table" aria-labelledby={captionId} aria-busy={collection.loading || undefined}>
        <caption id={captionId} className={cx("bk-table__caption", props.hideCaption && "bk-visually-hidden")}>
          {caption}
        </caption>
        <thead>
          <tr>
            {columns.map((column) => {
              const label = column.label ?? fieldLabel(column.field);
              const direction = sortDirection(column.field);
              return (
                <th key={column.field} scope="col" aria-sort={direction}>
                  {column.sortable ? (
                    <button
                      className="bk-sort"
                      type="button"
                      onClick={() => void collection.setSort(direction === "ascending" ? `-${column.field}` : column.field)}
                    >
                      {label}
                      <span className="bk-sort__icon" aria-hidden="true">
                        {direction === "ascending" ? " \u2191" : direction === "descending" ? " \u2193" : ""}
                      </span>
                    </button>
                  ) : (
                    label
                  )}
                </th>
              );
            })}
            {(props.deletable || props.actions) && (
              <th scope="col">
                <span className="bk-visually-hidden">Actions</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {collection.items.length === 0 && !collection.loading && (
            <tr>
              <td className="bk-table__empty" colSpan={columns.length + 1}>
                {props.emptyText ?? "Nothing here yet."}
              </td>
            </tr>
          )}
          {collection.items.map((row) => {
            const id = String(field(row, "id"));
            const pending = id.startsWith("pending-");
            return (
              <tr key={id} className={pending ? "bk-row--pending" : undefined}>
                {columns.map((column) => (
                  <td key={column.field} data-label={column.label ?? fieldLabel(column.field)}>
                    {column.render ? (
                      column.render(row)
                    ) : props.toggle?.includes(column.field) ? (
                      <input
                        className="bk-checkbox"
                        type="checkbox"
                        checked={field(row, column.field) === true}
                        disabled={pending}
                        aria-label={`${column.label ?? fieldLabel(column.field)}: ${rowName(row, entitySchema)}`}
                        onChange={(event) => void collection.update(id, { [column.field]: event.currentTarget.checked } as Partial<T>).catch(() => undefined)}
                      />
                    ) : (
                      formatValue(column.meta, field(row, column.field))
                    )}
                  </td>
                ))}
                {(props.deletable || props.actions) && (
                  <td className="bk-table__actions">
                    {props.actions?.(row, collection)}
                    {props.deletable && (
                      <button
                        className="bk-button bk-button--danger bk-button--small"
                        type="button"
                        disabled={pending}
                        aria-label={`Delete ${rowName(row, entitySchema)}`}
                        onClick={() => {
                          if (!confirmText || confirm(confirmText)) {
                            void collection.remove(id).catch(() => undefined);
                          }
                        }}
                      >
                        Delete
                      </button>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      <Pager collection={collection as unknown as CollectionHandle} label={caption} />
    </div>
  );
}

export interface LiveListProps<T extends Row = Row> extends UseCollectionOptions<T> {
  entity: string;
  /** Default: the entity's display field. */
  renderItem?: (row: T) => ReactNode;
  label?: string;
  emptyText?: string;
  collection?: CollectionHandle<T>;
  className?: string;
}

const LIVE_TEXT = { open: "Live", connecting: "Connecting", reconnecting: "Reconnecting", closed: "Offline", off: "Not live" } as const;

/** A list that stays current with realtime changes, with a connection badge. */
export function LiveList<T extends Row = Row>(props: LiveListProps<T>) {
  const view = (collection: CollectionHandle<T>) => <LiveListView {...props} collection={collection} />;
  return props.collection ? view(props.collection) : <OwnLive {...props} view={view} />;
}

function OwnLive<T extends Row>(props: LiveListProps<T> & { view: (collection: CollectionHandle<T>) => ReactNode }) {
  const collection = useCollection<T>(props.entity, { ...props, live: true });
  return <>{props.view(collection)}</>;
}

function LiveListView<T extends Row>(props: LiveListProps<T> & { collection: CollectionHandle<T> }) {
  const { schema } = useBakorin();
  const display = schema?.entities[props.entity]?.display ?? "id";
  const { collection } = props;
  const label = props.label ?? fieldLabel(props.entity);
  return (
    <section className={cx("bk-live-list", props.className)} aria-label={label}>
      <p className={cx("bk-live", `bk-live--${collection.live}`)} role="status">
        <span className="bk-live__dot" aria-hidden="true" />
        {LIVE_TEXT[collection.live]}
      </p>
      <FormAlert message={collection.error} />
      {collection.items.length === 0 && !collection.loading ? (
        <p className="bk-empty">{props.emptyText ?? "Nothing here yet."}</p>
      ) : (
        <ul className="bk-list" aria-busy={collection.loading || undefined}>
          {collection.items.map((row) => (
            <li key={String(field(row, "id"))} className="bk-list__item">
              {props.renderItem ? props.renderItem(row) : formatValue(undefined, field(row, display))}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
