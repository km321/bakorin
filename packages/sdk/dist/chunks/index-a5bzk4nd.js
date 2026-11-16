import {
  BakorinRequestError2
} from "./index-kvbz0pj9.js";

// src/headless/schema.ts
function fieldLabel2(name) {
  const base = name.length > 2 && name.endsWith("Id") ? name.slice(0, -2) : name;
  const words = base.replace(/[_-]+/g, " ").replace(/([a-z0-9])([A-Z])/g, "$1 $2").trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
function formFields2(entity, options = {}) {
  const editable = entity.fields.filter((field) => {
    if (field.system || field.owner || field.writable === "none") {
      return false;
    }
    if (field.writable === "admin" && !options.isAdmin) {
      return false;
    }
    if (field.secret && field.type !== "password") {
      return false;
    }
    if (field.type === "password" && options.mode === "update") {
      return false;
    }
    return !options.exclude?.includes(field.name);
  });
  if (!options.include) {
    return editable;
  }
  return options.include.flatMap((name) => editable.filter((field) => field.name === name));
}
function columnFields2(entity, include) {
  const readable = entity.fields.filter((field) => !field.secret && field.type !== "password");
  if (include) {
    return include.flatMap((name) => readable.filter((field) => field.name === name));
  }
  return readable.filter((field) => !field.system && !field.owner && !field.relation?.many);
}

// src/headless/store.ts
function createStore2(initial) {
  let value = initial;
  const listeners = new Set;
  return {
    get: () => value,
    set(next) {
      const resolved = typeof next === "function" ? next(value) : next;
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
    }
  };
}

// src/headless/form.ts
var EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function isEmpty(value) {
  return value === undefined || value === null || value === "" || Array.isArray(value) && value.length === 0;
}
function coerceValue2(field, raw) {
  if (field.type === "boolean") {
    return raw === true || raw === "true" || raw === "on" || raw === "1";
  }
  if (field.relation?.many) {
    return Array.isArray(raw) ? raw.filter((item) => item !== "") : isEmpty(raw) ? [] : [String(raw)];
  }
  if (isEmpty(raw)) {
    return null;
  }
  if (field.type === "number" || field.type === "integer") {
    const num = typeof raw === "number" ? raw : Number(String(raw).trim());
    return Number.isNaN(num) ? String(raw) : num;
  }
  if (field.type === "datetime") {
    const time = Date.parse(String(raw));
    return Number.isNaN(time) ? String(raw) : new Date(time).toISOString();
  }
  if (field.type === "email") {
    return String(raw).trim();
  }
  return typeof raw === "string" ? raw : String(raw);
}
function inputValue2(field, value) {
  if (value === null || value === undefined) {
    return "";
  }
  if (field.type === "datetime") {
    const date = new Date(String(value));
    if (Number.isNaN(date.getTime())) {
      return String(value);
    }
    const pad = (n) => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }
  return String(value);
}
function validateField2(field, value, mode = "create") {
  const label = fieldLabel2(field.name);
  if (isEmpty(value) || field.type === "boolean" && value === undefined) {
    const hasDefault = field.defaultValue !== undefined;
    if (field.required && !(mode === "create" && hasDefault && value === undefined) && field.type !== "boolean") {
      return `${label} is required`;
    }
    return;
  }
  if (field.minLength && field.type !== "password" && String(value).length < field.minLength) {
    return `${label} must be at least ${field.minLength} characters`;
  }
  switch (field.type) {
    case "integer":
      return Number.isInteger(value) ? undefined : `${label} must be a whole number`;
    case "number":
      return typeof value === "number" && Number.isFinite(value) ? undefined : `${label} must be a number`;
    case "email":
      return EMAIL.test(String(value)) ? undefined : `${label} must be an email address`;
    case "password": {
      const min = field.minLength ?? 8;
      return String(value).length >= min ? undefined : `${label} must be at least ${min} characters`;
    }
    case "enum":
      return field.enumValues?.includes(String(value)) ? undefined : `${label} must be one of ${field.enumValues?.join(", ")}`;
    case "date":
      return /^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? undefined : `${label} must be a date (YYYY-MM-DD)`;
    case "datetime":
      return Number.isNaN(Date.parse(String(value))) ? `${label} must be a date and time` : undefined;
    default:
      return;
  }
}
function validateRecord2(fields, values, mode = "create") {
  const errors = {};
  for (const field of fields) {
    if (mode === "update" && !(field.name in values)) {
      continue;
    }
    const message = validateField2(field, values[field.name], mode);
    if (message) {
      errors[field.name] = message;
    }
  }
  return errors;
}
function same(left, right) {
  if (Object.is(left, right)) {
    return true;
  }
  if ((left === null || left === undefined || left === "") && (right === null || right === undefined || right === "")) {
    return true;
  }
  if (Array.isArray(left) || Array.isArray(right) || typeof left === "object" && left && typeof right === "object" && right) {
    return JSON.stringify(left) === JSON.stringify(right);
  }
  return false;
}
function changedFields2(initial, values) {
  const out = {};
  for (const [key, value] of Object.entries(values)) {
    if (!same(initial[key], value)) {
      out[key] = value;
    }
  }
  return out;
}
function isRequestError2(error) {
  return error instanceof Error && error.name === "BakorinRequestError" && typeof error.status === "number";
}
function fieldErrorsFrom2(error, shownFields) {
  if (isRequestError2(error) && error.field && (!shownFields || shownFields.includes(error.field))) {
    const message = error.message.startsWith(error.field) ? fieldLabel2(error.field) + error.message.slice(error.field.length) : error.message;
    return { fields: { [error.field]: message } };
  }
  if (error instanceof Error) {
    return { fields: {}, message: error.message };
  }
  return { fields: {}, message: "Something went wrong. Try again." };
}
function createForm2(options) {
  const mode = options.initial ? "update" : "create";
  let initial = {};
  const startValues = (source) => {
    const values = {};
    for (const field of options.fields) {
      if (source && field.name in source) {
        values[field.name] = source[field.name];
      } else if (field.defaultValue !== undefined) {
        values[field.name] = field.defaultValue;
      } else if (field.type === "boolean") {
        values[field.name] = false;
      } else if (field.relation?.many) {
        values[field.name] = [];
      }
    }
    return values;
  };
  initial = startValues(options.initial);
  const store = createStore2({ values: initial, errors: {}, formError: null, submitting: false, submitted: false });
  const byName = new Map(options.fields.map((field) => [field.name, field]));
  const shown = options.fields.map((field) => field.name);
  const outgoing = () => {
    const values = store.get().values;
    if (mode === "update") {
      return changedFields2(initial, values);
    }
    const out = {};
    for (const [key, value] of Object.entries(values)) {
      if (value !== null && value !== undefined) {
        out[key] = value;
      }
    }
    return out;
  };
  const validate = () => {
    const values = mode === "update" ? { ...initial, ...store.get().values } : store.get().values;
    const errors = validateRecord2(options.fields, values, mode);
    store.set((state) => ({ ...state, errors }));
    return errors;
  };
  return {
    store,
    mode,
    setValue(name, raw) {
      const field = byName.get(name);
      const value = field ? coerceValue2(field, raw) : raw;
      store.set((state) => {
        const errors = { ...state.errors };
        delete errors[name];
        return { ...state, values: { ...state.values, [name]: value }, errors, submitted: false };
      });
    },
    validate,
    async submit() {
      const errors = validate();
      if (Object.keys(errors).length > 0) {
        store.set((state) => ({ ...state, formError: null }));
        return;
      }
      const body = outgoing();
      store.set((state) => ({ ...state, submitting: true, formError: null }));
      try {
        const result = await options.submit(body, mode);
        if (mode === "update") {
          initial = { ...initial, ...body };
        }
        store.set((state) => ({ ...state, submitting: false, submitted: true }));
        options.onSuccess?.(result);
        return result;
      } catch (error) {
        const mapped = fieldErrorsFrom2(error, shown);
        store.set((state) => ({ ...state, submitting: false, errors: mapped.fields, formError: mapped.message ?? null }));
        return;
      }
    },
    reset(values) {
      initial = startValues(values ?? options.initial);
      store.set({ values: initial, errors: {}, formError: null, submitting: false, submitted: false });
    }
  };
}

// src/headless/format.ts
function formatValue2(field, value, locale) {
  if (value === null || value === undefined || value === "") {
    return "";
  }
  if (field?.type === "boolean") {
    return value ? "Yes" : "No";
  }
  if (field?.type === "datetime") {
    const date = new Date(String(value));
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
  }
  if (field?.type === "date") {
    const date = new Date(`${String(value)}T00:00:00`);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString(locale, { dateStyle: "medium" });
  }
  if (Array.isArray(value)) {
    return value.map((item) => formatValue2(undefined, item, locale)).join(", ");
  }
  if (typeof value === "object") {
    const record = value;
    return String(record.name ?? record.title ?? record.email ?? record.id ?? "");
  }
  return String(value);
}

// src/headless/collection.ts
var idOf = (row) => row.id;
function pageInfo2(state) {
  const limit = Math.max(1, state.limit);
  const page = Math.floor(state.offset / limit);
  const pages = Math.max(1, Math.ceil(state.total / limit));
  return {
    page,
    pages,
    hasPrevious: state.offset > 0,
    hasNext: state.offset + state.items.length < state.total,
    from: state.items.length ? state.offset + 1 : 0,
    to: state.offset + state.items.length
  };
}
function applyChange2(state, change) {
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
var tempCounter = 0;
function createCollection2(client, entity, options = {}) {
  const api = client.entity(entity);
  const store = createStore2({
    items: options.initial?.data ?? [],
    total: options.initial?.meta.total ?? 0,
    limit: options.initial?.meta.limit ?? options.limit ?? 20,
    offset: options.initial?.meta.offset ?? options.offset ?? 0,
    sort: options.sort,
    filter: options.filter,
    loading: !options.initial,
    error: null,
    live: "off"
  });
  let loadId = 0;
  async function load() {
    const id = ++loadId;
    const { limit, offset, sort, filter } = store.get();
    store.set((state) => ({ ...state, loading: true, error: null }));
    try {
      const result = await api.list({ limit, offset, sort, filter, expand: options.expand });
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
  function patchItems(update, totalDelta = 0) {
    store.set((state) => ({ ...state, items: update(state.items), total: Math.max(0, state.total + totalDelta) }));
  }
  function fail(error) {
    store.set((state) => ({ ...state, error: error instanceof Error ? error.message : String(error) }));
    throw error;
  }
  async function setPage(page) {
    store.set((state) => ({ ...state, offset: Math.max(0, page) * state.limit }));
    await load();
  }
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
      return await api.get(id, options.expand);
    },
    async create(body) {
      const tempId = `pending-${++tempCounter}`;
      const optimistic = { ...body, id: tempId };
      const firstPage = store.get().offset === 0;
      if (firstPage) {
        patchItems((items) => [optimistic, ...items], 1);
      }
      try {
        const saved = await api.create(body);
        store.set((state) => {
          const without = state.items.filter((item) => idOf(item) !== tempId);
          const exists = without.some((item) => idOf(item) === idOf(saved));
          const items = exists ? without : firstPage ? [saved, ...without] : without;
          const total = firstPage ? exists ? state.total - 1 : state.total : state.live === "off" ? state.total + 1 : state.total;
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
      patchItems((items) => items.map((item) => idOf(item) === id ? { ...item, ...patch } : item));
      try {
        const saved = await api.update(id, patch);
        patchItems((items) => items.map((item) => idOf(item) === id ? saved : item));
        return saved;
      } catch (error) {
        if (before) {
          patchItems((items) => items.map((item) => idOf(item) === id ? before : item));
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
      const stop = client.subscribe(entity, (change) => {
        store.set((state) => ({ ...state, ...applyChange2(state, change) }));
      }, {
        onReset: () => void load(),
        onStatus: (live) => store.set((state) => ({ ...state, live })),
        onError: (error) => store.set((state) => ({ ...state, error: error.message }))
      });
      return () => {
        stop();
        store.set((state) => ({ ...state, live: "off" }));
      };
    }
  };
}

// src/headless/upload.ts
function acceptsType2(type, accept) {
  if (!accept || accept.length === 0) {
    return true;
  }
  const lower = type.toLowerCase();
  return accept.some((pattern) => {
    const p = pattern.trim().toLowerCase();
    return p.endsWith("/*") ? lower.startsWith(p.slice(0, -1)) : lower === p;
  });
}
function checkFile2(file, options) {
  if (options.maxBytes !== undefined && file.size > options.maxBytes) {
    return `The file is larger than ${formatBytes2(options.maxBytes)}`;
  }
  if (!acceptsType2(file.type || "application/octet-stream", options.accept)) {
    return "This file type is not allowed";
  }
  return;
}
function formatBytes2(bytes) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || Number.isInteger(value) ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}
function uploadUrl(options) {
  const basePath = (options.basePath ?? "/api/bakorin").replace(/\/+$/, "");
  return `${options.origin ?? ""}${basePath}/files`;
}
function throughSite(file, options) {
  if (!file.url.startsWith("/api/v1/")) {
    return file;
  }
  const basePath = (options.basePath ?? "/api/bakorin").replace(/\/+$/, "");
  const site = (link) => link.startsWith("/api/v1/") ? `${options.origin ?? ""}${basePath}${link.slice("/api/v1".length)}` : link;
  return { ...file, url: site(file.url), downloadUrl: site(file.downloadUrl ?? `${file.url}&download=1`) };
}
function errorFrom(status, text) {
  try {
    const json = JSON.parse(text);
    return new BakorinRequestError2(json.error?.message ?? `upload failed (${status})`, status, json.error?.code ?? "error", json.error?.field);
  } catch {
    return new BakorinRequestError2(`upload failed (${status})`, status, "error");
  }
}
async function uploadFile2(file, options = {}) {
  const problem = checkFile2({ size: file.size, type: file.type }, options);
  if (problem) {
    throw new BakorinRequestError2(problem, 400, "invalid_file", "file");
  }
  const form = new FormData;
  form.set("file", file, file.name ?? "upload");
  const url = uploadUrl(options);
  if (typeof XMLHttpRequest === "undefined" || !options.onProgress) {
    const fetcher = options.fetch ?? ((input, init) => fetch(input, init));
    const response = await fetcher(url, { method: "POST", body: form, credentials: "same-origin", signal: options.signal });
    const text = await response.text();
    if (!response.ok) {
      throw errorFrom(response.status, text);
    }
    options.onProgress?.(1);
    return throughSite(JSON.parse(text).data, options);
  }
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest;
    xhr.open("POST", url);
    xhr.setRequestHeader("accept", "application/json");
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        options.onProgress?.(event.loaded / event.total);
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        options.onProgress?.(1);
        resolve(throughSite(JSON.parse(xhr.responseText).data, options));
      } else {
        reject(errorFrom(xhr.status, xhr.responseText));
      }
    };
    xhr.onerror = () => reject(new BakorinRequestError2("The upload failed. Check your connection.", 0, "network"));
    xhr.onabort = () => reject(new BakorinRequestError2("The upload was cancelled.", 0, "aborted"));
    options.signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(form);
  });
}
function createUpload2(options = {}) {
  const idle = { status: "idle", progress: 0, file: null, error: null };
  const store = createStore2(idle);
  let controller = null;
  return {
    store,
    async upload(file) {
      controller?.abort();
      controller = new AbortController;
      store.set({ status: "uploading", progress: 0, file: null, error: null });
      try {
        const uploaded = await uploadFile2(file, {
          ...options,
          signal: controller.signal,
          onProgress: (progress) => store.set((state) => ({ ...state, progress }))
        });
        store.set({ status: "done", progress: 1, file: uploaded, error: null });
        return uploaded;
      } catch (error) {
        store.set({ status: "error", progress: 0, file: null, error: error instanceof Error ? error.message : String(error) });
        return null;
      }
    },
    cancel() {
      controller?.abort();
    },
    reset() {
      controller?.abort();
      store.set(idle);
    }
  };
}
async function signedFileUrl2(client, fileId) {
  return (await client.files.sign(fileId)).url;
}
function clientFileUrl2(client, signedPath) {
  return signedPath.startsWith("/api/v1") ? client.apiUrl(signedPath.slice("/api/v1".length)) : signedPath;
}

export { fieldLabel2, formFields2, columnFields2, createStore2, coerceValue2, inputValue2, validateField2, validateRecord2, changedFields2, isRequestError2, fieldErrorsFrom2, createForm2, formatValue2, pageInfo2, applyChange2, createCollection2, acceptsType2, checkFile2, formatBytes2, uploadFile2, createUpload2, signedFileUrl2, clientFileUrl2 };
