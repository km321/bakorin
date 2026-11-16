import type { Store } from "../headless/store.ts";
import { type CollectionOptions } from "../headless/collection.ts";
import { type UploadOptions } from "../headless/upload.ts";
import { type FormValues } from "../headless/form.ts";
import { type EntitySchema, type FieldSchema, type FormFieldOptions } from "../headless/schema.ts";
/** Reads a headless store and re-renders when it changes. */
export declare function useStore<T>(store: Store<T>): T;
/**
 * The signed in user and the auth actions. Loads the user once when the provider
 * had no initialUser.
 */
export declare function useAuth<U = Record<string, unknown>>(): {
    signIn: (credentials: Record<string, unknown>) => Promise<Record<string, unknown> | null>;
    signUp: (body: Record<string, unknown>) => Promise<import("../index.ts").SignupResult | null>;
    signOut: (options?: {
        all?: boolean;
    }) => Promise<void>;
    forgotPassword: (email: string) => Promise<boolean>;
    resetPassword: (token: string, password: string) => Promise<boolean>;
    refresh: () => Promise<Record<string, unknown> | null>;
    status: import("../headless.ts").AuthStatus;
    user: U | null;
    error: string | null;
    pending: boolean;
};
export interface UseCollectionOptions<T> extends CollectionOptions<T> {
    /** Keep the page in sync with realtime changes (the entity needs realtime: true). */
    live?: boolean;
}
/** A page of records with pagination, sort, filter, and optimistic writes. */
export declare function useCollection<T extends object = Record<string, unknown>>(entity: string, options?: UseCollectionOptions<T>): {
    page: import("../headless.ts").PageInfo;
    load: () => Promise<void>;
    setPage: (page: number) => Promise<void>;
    next: () => Promise<void>;
    previous: () => Promise<void>;
    setSort: (sort: string | undefined) => Promise<void>;
    setFilter: (filter: import("../index.ts").Query["filter"]) => Promise<void>;
    create: (body: Partial<T>) => Promise<T>;
    update: (id: string, patch: Partial<T>) => Promise<T>;
    remove: (id: string) => Promise<void>;
    items: T[];
    total: number;
    limit: number;
    offset: number;
    sort?: string;
    filter: import("../index.ts").Query["filter"];
    loading: boolean;
    error: string | null;
    live: import("../index.ts").RealtimeStatus | "off";
};
/** useCollection with realtime on. */
export declare function useLiveList<T extends object = Record<string, unknown>>(entity: string, options?: CollectionOptions<T>): {
    page: import("../headless.ts").PageInfo;
    load: () => Promise<void>;
    setPage: (page: number) => Promise<void>;
    next: () => Promise<void>;
    previous: () => Promise<void>;
    setSort: (sort: string | undefined) => Promise<void>;
    setFilter: (filter: import("../index.ts").Query["filter"]) => Promise<void>;
    create: (body: Partial<T>) => Promise<T>;
    update: (id: string, patch: Partial<T>) => Promise<T>;
    remove: (id: string) => Promise<void>;
    items: T[];
    total: number;
    limit: number;
    offset: number;
    sort?: string;
    filter: import("../index.ts").Query["filter"];
    loading: boolean;
    error: string | null;
    live: import("../index.ts").RealtimeStatus | "off";
};
/** Upload state for one file input: progress, the stored file, and errors. */
export declare function useUpload(options?: Omit<UploadOptions, "onProgress" | "signal" | "basePath">): {
    upload: (file: Blob) => Promise<import("../index.ts").UploadedFile | null>;
    cancel: () => void;
    reset: () => void;
    status: "idle" | "uploading" | "done" | "error";
    progress: number;
    file: import("../index.ts").UploadedFile | null;
    error: string | null;
};
export interface UseRecordFormOptions<R> extends FormFieldOptions {
    entity: string | EntitySchema;
    /** The record to edit. Leave out to create one. */
    record?: object;
    /** Use your own fields instead of the schema's. */
    fields?: readonly FieldSchema[];
    /** Override the write, for example to go through a collection for optimistic updates. */
    submit?: (values: FormValues, mode: "create" | "update") => Promise<R>;
    onSuccess?: (record: R) => void;
}
/** Form state for an entity: values, validation, changed field PATCHes, and server errors on fields. */
export declare function useRecordForm<R = Record<string, unknown>>(options: UseRecordFormOptions<R>): {
    fields: readonly FieldSchema[];
    mode: "create" | "update";
    store: Store<import("../headless.ts").FormState>;
    setValue: (name: string, raw: unknown) => void;
    submit: () => Promise<R | undefined>;
    reset: (values?: FormValues) => void;
    validate: () => import("../headless.ts").FieldErrors;
    values: FormValues;
    errors: import("../headless.ts").FieldErrors;
    formError: string | null;
    submitting: boolean;
    submitted: boolean;
};
/** Labels for relation pickers: loads the related entity once and maps ids to display values. */
export declare function useRelationOptions(field: FieldSchema | undefined, enabled?: boolean): {
    value: string;
    label: string;
}[] | null;
