/** @jsxImportSource react */
import { type ReactNode } from "react";
import { useCollection, type UseCollectionOptions } from "./hooks.ts";
type Row = object;
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
    /** Makes one column a link to each row's page, for example { field: "name", href: "/app/projects/:id" }. */
    rowLink?: {
        field: string;
        href: string;
    };
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
/** Pagination controls with a live summary. */
export declare function Pager({ collection, label }: {
    collection: CollectionHandle;
    label: string;
}): import("react").JSX.Element;
/** A paged, sortable table for an entity, with optional toggles and delete. */
export declare function DataTable<T extends Row = Row>(props: DataTableProps<T>): import("react").JSX.Element;
export interface LiveListProps<T extends Row = Row> extends UseCollectionOptions<T> {
    entity: string;
    /** Default: the entity's display field. */
    renderItem?: (row: T) => ReactNode;
    label?: string;
    emptyText?: string;
    collection?: CollectionHandle<T>;
    className?: string;
}
/** A list that stays current with realtime changes, with a connection badge. */
export declare function LiveList<T extends Row = Row>(props: LiveListProps<T>): import("react").JSX.Element;
export {};
