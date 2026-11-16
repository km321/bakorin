import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { Store } from "../headless/store.ts";
import type { AuthState } from "../headless/auth.ts";
import { createCollection, pageInfo, type CollectionOptions } from "../headless/collection.ts";
import { createUpload, type UploadOptions } from "../headless/upload.ts";
import { createForm, type FormValues } from "../headless/form.ts";
import { formFields, type EntitySchema, type FieldSchema, type FormFieldOptions } from "../headless/schema.ts";
import { useBakorin } from "./context.tsx";

/** Reads a headless store and re-renders when it changes. */
export function useStore<T>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

/**
 * The signed in user and the auth actions. Loads the user once when the provider
 * had no initialUser.
 */
export function useAuth<U = Record<string, unknown>>() {
  const { auth } = useBakorin();
  const state = useStore(auth.store) as AuthState<U>;
  useEffect(() => {
    if (auth.store.get().status === "loading") {
      void auth.refresh();
    }
  }, [auth]);
  return {
    ...state,
    signIn: auth.signIn,
    signUp: auth.signUp,
    signOut: auth.signOut,
    forgotPassword: auth.forgotPassword,
    resetPassword: auth.resetPassword,
    refresh: auth.refresh,
  };
}

export interface UseCollectionOptions<T> extends CollectionOptions<T> {
  /** Keep the page in sync with realtime changes (the entity needs realtime: true). */
  live?: boolean;
}

/** A page of records with pagination, sort, filter, and optimistic writes. */
export function useCollection<T extends object = Record<string, unknown>>(
  entity: string,
  options: UseCollectionOptions<T> = {},
) {
  const { client } = useBakorin();
  const filterKey = JSON.stringify(options.filter ?? null);
  const controller = useMemo(
    () => createCollection<T>(client, entity, options),
    // Recreate only when the query itself changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [client, entity, options.limit, options.sort, filterKey, options.expand],
  );
  const state = useStore(controller.store);
  useEffect(() => {
    if (!options.initial) {
      void controller.load();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controller]);
  useEffect(() => (options.live ? controller.live() : undefined), [controller, options.live]);
  return {
    ...state,
    page: pageInfo(state),
    load: controller.load,
    setPage: controller.setPage,
    next: controller.next,
    previous: controller.previous,
    setSort: controller.setSort,
    setFilter: controller.setFilter,
    create: controller.create,
    update: controller.update,
    remove: controller.remove,
  };
}

/** useCollection with realtime on. */
export function useLiveList<T extends object = Record<string, unknown>>(
  entity: string,
  options: CollectionOptions<T> = {},
) {
  return useCollection<T>(entity, { ...options, live: true });
}

/** Upload state for one file input: progress, the stored file, and errors. */
export function useUpload(options: Omit<UploadOptions, "onProgress" | "signal" | "basePath"> = {}) {
  const { basePath } = useBakorin();
  const optionsKey = JSON.stringify(options);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const controller = useMemo(() => createUpload({ basePath, ...options }), [basePath, optionsKey]);
  useEffect(() => () => controller.cancel(), [controller]);
  const state = useStore(controller.store);
  return { ...state, upload: controller.upload, cancel: controller.cancel, reset: controller.reset };
}

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
export function useRecordForm<R = Record<string, unknown>>(options: UseRecordFormOptions<R>) {
  const { client, schema } = useBakorin();
  const entitySchema = typeof options.entity === "string" ? schema?.entities[options.entity] : options.entity;
  const entityName = typeof options.entity === "string" ? options.entity : options.entity.name;
  const fields = useMemo(
    () =>
      options.fields ??
      (entitySchema
        ? formFields(entitySchema, { mode: options.record ? "update" : "create", isAdmin: options.isAdmin, include: options.include, exclude: options.exclude })
        : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entitySchema, options.fields, Boolean(options.record), options.isAdmin, String(options.include), String(options.exclude)],
  );
  const latest = useRef(options);
  latest.current = options;
  const recordId = (options.record as { id?: unknown } | undefined)?.id;
  const form = useMemo(
    () =>
      createForm<R>({
        fields,
        initial: latest.current.record as FormValues | undefined,
        submit: (values, mode) => {
          if (latest.current.submit) {
            return latest.current.submit(values, mode);
          }
          const api = client.entity(entityName);
          return (mode === "update" ? api.update(String(recordId), values) : api.create(values)) as Promise<R>;
        },
        onSuccess: (record) => latest.current.onSuccess?.(record),
      }),
    [client, entityName, fields, recordId],
  );
  const state = useStore(form.store);
  return { ...state, fields, mode: form.mode, store: form.store, setValue: form.setValue, submit: form.submit, reset: form.reset, validate: form.validate };
}

/** Labels for relation pickers: loads the related entity once and maps ids to display values. */
export function useRelationOptions(field: FieldSchema | undefined, enabled = true) {
  const { client, schema } = useBakorin();
  const [options, setOptions] = useState<{ value: string; label: string }[] | null>(null);
  const to = field?.relation?.to;
  const display = to ? schema?.entities[to]?.display : undefined;
  const load = useCallback(async () => {
    if (!to || !enabled) {
      return;
    }
    try {
      const result = await client.entity(to).list({ limit: 100, sort: display });
      setOptions(result.data.map((row) => ({ value: String(row.id), label: String(row[display ?? "id"] ?? row.id) })));
    } catch {
      setOptions(null);
    }
  }, [client, to, display, enabled]);
  useEffect(() => {
    void load();
  }, [load]);
  return options;
}
