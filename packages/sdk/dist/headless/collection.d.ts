import type { BakorinClient, ListResult, Query, RealtimeChange, RealtimeStatus } from "../index.ts";
import { type Store } from "./store.ts";
type Row = object;
export interface CollectionState<T> {
    items: T[];
    /** Rows matching the filter on the server, across all pages. */
    total: number;
    limit: number;
    offset: number;
    sort?: string;
    filter: Query["filter"];
    /** The first load, or a page, sort, or filter change, is running. */
    loading: boolean;
    error: string | null;
    /** Realtime stream status once live() is on. */
    live: RealtimeStatus | "off";
}
export interface CollectionOptions<T> {
    limit?: number;
    offset?: number;
    sort?: string;
    filter?: Query["filter"];
    expand?: string;
    /** A first page the server already loaded. Skips the first fetch. */
    initial?: ListResult<T>;
}
export interface CollectionController<T> {
    store: Store<CollectionState<T>>;
    load(): Promise<void>;
    /** Zero based page number. */
    setPage(page: number): Promise<void>;
    next(): Promise<void>;
    previous(): Promise<void>;
    /** "title" ascending, "-title" descending. Resets to the first page. */
    setSort(sort: string | undefined): Promise<void>;
    setFilter(filter: Query["filter"]): Promise<void>;
    get(id: string): Promise<T>;
    /** Shows the row at once, then swaps in the saved record. Rolls back and rethrows on error. */
    create(body: Partial<T>): Promise<T>;
    /** Applies the change at once. Rolls back and rethrows on error. */
    update(id: string, patch: Partial<T>): Promise<T>;
    /** Removes the row at once. Puts it back and rethrows on error. */
    remove(id: string): Promise<void>;
    /** Keeps the current page in sync with subscribe(). Returns a function that stops it. */
    live(): () => void;
}
export interface PageInfo {
    page: number;
    pages: number;
    hasPrevious: boolean;
    hasNext: boolean;
    /** One based numbers for "Showing 21 to 40 of 57". */
    from: number;
    to: number;
}
export declare function pageInfo(state: Pick<CollectionState<unknown>, "total" | "limit" | "offset" | "items">): PageInfo;
/**
 * Applies one realtime change to a page of rows. New rows go on top of the first
 * page only, so later pages do not shift under the reader.
 */
export declare function applyChange<T extends Row>(state: Pick<CollectionState<T>, "items" | "total" | "offset" | "limit">, change: RealtimeChange<T>): Pick<CollectionState<T>, "items" | "total">;
export declare function createCollection<T extends Row = Row>(client: BakorinClient, entity: string, options?: CollectionOptions<T>): CollectionController<T>;
export {};
