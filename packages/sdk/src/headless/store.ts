/** A tiny observable value. Framework bindings (React hooks, custom elements) subscribe to it. */
export interface Store<T> {
  get(): T;
  set(next: T | ((previous: T) => T)): void;
  /** Calls listener after every change. Returns an unsubscribe function. */
  subscribe(listener: (value: T) => void): () => void;
}

export function createStore<T>(initial: T): Store<T> {
  let value = initial;
  const listeners = new Set<(value: T) => void>();
  return {
    get: () => value,
    set(next) {
      const resolved = typeof next === "function" ? (next as (previous: T) => T)(value) : next;
      if (Object.is(resolved, value)) {
        return;
      }
      value = resolved;
      for (const listener of [...listeners]) {
        listener(value);
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
