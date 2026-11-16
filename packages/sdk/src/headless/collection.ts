import type { BakorinClient, ListResult, Query, RealtimeChange, RealtimeStatus } from "../index.ts";
import { createStore, type Store } from "./store.ts";

type Row = object;

/** The id of a row (generated interfaces have no index signature, so read it loosely). */
const idOf = (row: object): unknown => (row as { id?: unknown }).id;

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

export function pageInfo(state: Pick<CollectionState<unknown>, "total" | "limit" | "offset" | "items">): PageInfo {
  const limit = Math.max(1, state.limit);
  const page = Math.floor(state.offset / limit);
  const pages = Math.max(1, Math.ceil(state.total / limit));
  return {
    page,
    pages,
    hasPrevious: state.offset > 0,
    hasNext: state.offset + state.items.length < state.total,
    from: state.items.length ? state.offset + 1 : 0,
    to: state.offset + state.items.length,
  };
}

/**
 * Applies one realtime change to a page of rows. New rows go on top of the first
 * page only, so later pages do not shift under the reader.
 */
export function applyChange<T extends Row>(
  state: Pick<CollectionState<T>, "items" | "total" | "offset" | "limit">,
  change: RealtimeChange<T>,
): Pick<CollectionState<T>, "items" | "total"> {
  const index = state.items.findIndex((item) => idOf(item) === change.id);
  if (change.op === "delete") {
    if (index === -1) {
      return { items: state.items, total: state.total };
    }
    return { items: state.items.filter((_, i) => i !== index), total: Math.max(0, state.total - 1) };
  }
  if (!change.record) {
    return { items: state.items, total: state.total };
  }
  if (index !== -1) {
    const items = state.items.slice();
    items[index] = { ...items[index], ...change.record };
    return { items, total: state.total };
  }
  if (change.op === "create") {
    if (state.offset !== 0) {
      return { items: state.items, total: state.total + 1 };
    }
    return { items: [change.record, ...state.items].slice(0, state.limit), total: state.total + 1 };
  }
  return { items: state.items, total: state.total };
}

let tempCounter = 0;

export function createCollection<T extends Row = Row>(
  client: BakorinClient,
  entity: string,
  options: CollectionOptions<T> = {},
): CollectionController<T> {
  const api = client.entity(entity);
  const store = createStore<CollectionState<T>>({
    items: options.initial?.data ?? [],
    total: options.initial?.meta.total ?? 0,
    limit: options.initial?.meta.limit ?? options.limit ?? 20,
    offset: options.initial?.meta.offset ?? options.offset ?? 0,
    sort: options.sort,
    filter: options.filter,
    loading: !options.initial,
    error: null,
    live: "off",
  });
  let loadId = 0;

  async function load(): Promise<void> {
    const id = ++loadId;
    const { limit, offset, sort, filter } = store.get();
    store.set((state) => ({ ...state, loading: true, error: null }));
    try {
      const result = (await api.list({ limit, offset, sort, filter, expand: options.expand })) as ListResult<T>;
      if (id !== loadId) {
        return;
      }
      store.set((state) => ({ ...state, items: result.data, total: result.meta.total, loading: false }));
    } catch (error) {
      if (id === loadId) {
        store.set((state) => ({ ...state, loading: false, error: error instanceof Error ? error.message : String(error) }));
      }
    }
  }

  function patchItems(update: (items: T[]) => T[], totalDelta = 0) {
    store.set((state) => ({ ...state, items: update(state.items), total: Math.max(0, state.total + totalDelta) }));
  }

  function fail(error: unknown): never {
    store.set((state) => ({ ...state, error: error instanceof Error ? error.message : String(error) }));
    throw error;
  }

  async function setPage(page: number): Promise<void> {
    store.set((state) => ({ ...state, offset: Math.max(0, page) * state.limit }));
    await load();
  }

  // Methods never use this, so they can be passed around detached (React props, event handlers).
  return {
    store,
    load,
    setPage,
    async next() {
      const state = store.get();
      if (state.offset + state.items.length < state.total) {
        await setPage(Math.floor(state.offset / state.limit) + 1);
      }
    },
    async previous() {
      const state = store.get();
      if (state.offset > 0) {
        await setPage(Math.floor(state.offset / state.limit) - 1);
      }
    },
    async setSort(sort) {
      store.set((state) => ({ ...state, sort, offset: 0 }));
      await load();
    },
    async setFilter(filter) {
      store.set((state) => ({ ...state, filter, offset: 0 }));
      await load();
    },
    async get(id) {
      return (await api.get(id, options.expand)) as T;
    },
    async create(body) {
      const tempId = `pending-${++tempCounter}`;
      const optimistic = { ...body, id: tempId } as unknown as T;
      const firstPage = store.get().offset === 0;
      if (firstPage) {
        patchItems((items) => [optimistic, ...items], 1);
      }
      try {
        const saved = (await api.create(body as never)) as T;
        store.set((state) => {
          // A realtime event may have added the saved row already.
          const without = state.items.filter((item) => idOf(item) !== tempId);
          const exists = without.some((item) => idOf(item) === idOf(saved));
          const items = exists ? without : firstPage ? [saved, ...without] : without;
          // With live() on, the realtime create event already counted a row saved off the first page.
          const total = firstPage ? (exists ? state.total - 1 : state.total) : state.live === "off" ? state.total + 1 : state.total;
          return { ...state, items, total, error: null };
        });
        return saved;
      } catch (error) {
        if (firstPage) {
          patchItems((items) => items.filter((item) => idOf(item) !== tempId), -1);
        }
        return fail(error);
      }
    },
    async update(id, patch) {
      const before = store.get().items.find((item) => idOf(item) === id);
      patchItems((items) => items.map((item) => (idOf(item) === id ? { ...item, ...patch } : item)));
      try {
        const saved = (await api.update(id, patch as never)) as T;
        patchItems((items) => items.map((item) => (idOf(item) === id ? saved : item)));
        return saved;
      } catch (error) {
        if (before) {
          patchItems((items) => items.map((item) => (idOf(item) === id ? before : item)));
        }
        return fail(error);
      }
    },
    async remove(id) {
      const items = store.get().items;
      const index = items.findIndex((item) => idOf(item) === id);
      const before = items[index];
      if (before) {
        patchItems((list) => list.filter((item) => idOf(item) !== id), -1);
      }
      try {
        await api.delete(id);
      } catch (error) {
        if (before) {
          patchItems((list) => {
            const copy = list.slice();
            copy.splice(Math.min(index, copy.length), 0, before);
            return copy;
          }, 1);
        }
        fail(error);
      }
    },
    live() {
      const stop = client.subscribe(
        entity,
        (change) => {
          store.set((state) => ({ ...state, ...applyChange(state, change as RealtimeChange<T>) }));
        },
        {
          onReset: () => void load(),
          onStatus: (live) => store.set((state) => ({ ...state, live })),
          onError: (error) => store.set((state) => ({ ...state, error: error.message })),
        },
      );
      return () => {
        stop();
        store.set((state) => ({ ...state, live: "off" }));
      };
    },
  };
}
