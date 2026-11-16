/** A tiny observable value. Framework bindings (React hooks, custom elements) subscribe to it. */
export interface Store<T> {
    get(): T;
    set(next: T | ((previous: T) => T)): void;
    /** Calls listener after every change. Returns an unsubscribe function. */
    subscribe(listener: (value: T) => void): () => void;
}
export declare function createStore<T>(initial: T): Store<T>;
