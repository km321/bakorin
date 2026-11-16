import type { BakorinRequestError } from "../index.ts";
import { fieldLabel, type FieldSchema } from "./schema.ts";
import { createStore, type Store } from "./store.ts";

export type FieldErrors = Record<string, string>;
export type FormValues = Record<string, unknown>;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isEmpty(value: unknown): boolean {
  return value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);
}

/**
 * Turns what an input holds (always a string, or a boolean for checkboxes) into
 * the value the API expects. Empty optional inputs become null on update and are
 * left out on create, which matches how the server treats them.
 */
export function coerceValue(field: FieldSchema, raw: unknown): unknown {
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
    // datetime-local inputs have no zone; read them as local time like the browser shows them.
    const time = Date.parse(String(raw));
    return Number.isNaN(time) ? String(raw) : new Date(time).toISOString();
  }
  if (field.type === "email") {
    return String(raw).trim();
  }
  return typeof raw === "string" ? raw : String(raw);
}

/** Formats an API value for an input's value attribute. */
export function inputValue(field: FieldSchema, value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (field.type === "datetime") {
    const date = new Date(String(value));
    if (Number.isNaN(date.getTime())) {
      return String(value);
    }
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }
  return String(value);
}

/** The same checks the server runs, so most mistakes show before a round trip. */
export function validateField(field: FieldSchema, value: unknown, mode: "create" | "update" = "create"): string | undefined {
  const label = fieldLabel(field.name);
  if (isEmpty(value) || (field.type === "boolean" && value === undefined)) {
    const hasDefault = field.defaultValue !== undefined;
    if (field.required && !(mode === "create" && hasDefault && value === undefined) && field.type !== "boolean") {
      return `${label} is required`;
    }
    return undefined;
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
      return undefined;
  }
}

/** Validates every field. Returns an empty object when the values are fine. */
export function validateRecord(fields: readonly FieldSchema[], values: FormValues, mode: "create" | "update" = "create"): FieldErrors {
  const errors: FieldErrors = {};
  for (const field of fields) {
    if (mode === "update" && !(field.name in values)) {
      continue;
    }
    const message = validateField(field, values[field.name], mode);
    if (message) {
      errors[field.name] = message;
    }
  }
  return errors;
}

function same(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }
  if ((left === null || left === undefined || left === "") && (right === null || right === undefined || right === "")) {
    return true;
  }
  if (Array.isArray(left) || Array.isArray(right) || (typeof left === "object" && left && typeof right === "object" && right)) {
    return JSON.stringify(left) === JSON.stringify(right);
  }
  return false;
}

/** Only the values that differ from initial, for a PATCH that leaves everything else alone. */
export function changedFields(initial: FormValues, values: FormValues): FormValues {
  const out: FormValues = {};
  for (const [key, value] of Object.entries(values)) {
    if (!same(initial[key], value)) {
      out[key] = value;
    }
  }
  return out;
}

/** True for errors the SDK throws for a server answer. Works across bundles, unlike instanceof. */
export function isRequestError(error: unknown): error is BakorinRequestError {
  return error instanceof Error && error.name === "BakorinRequestError" && typeof (error as BakorinRequestError).status === "number";
}

export interface ErrorMapping {
  /** Messages keyed by field name, for errors the server tied to a field. */
  fields: FieldErrors;
  /** A message for the whole form (no field, or a field this form does not show). */
  message?: string;
}

/**
 * Splits an error from the SDK into field messages and a form message.
 * Pass the field names the form shows so errors for hidden fields still surface.
 */
export function fieldErrorsFrom(error: unknown, shownFields?: readonly string[]): ErrorMapping {
  if (isRequestError(error) && error.field && (!shownFields || shownFields.includes(error.field))) {
    // The server writes the raw field name; swap in the label people see.
    const message = error.message.startsWith(error.field)
      ? fieldLabel(error.field) + error.message.slice(error.field.length)
      : error.message;
    return { fields: { [error.field]: message } };
  }
  if (error instanceof Error) {
    return { fields: {}, message: error.message };
  }
  return { fields: {}, message: "Something went wrong. Try again." };
}

export interface FormState {
  values: FormValues;
  errors: FieldErrors;
  /** Error for the whole form, shown in an alert. */
  formError: string | null;
  submitting: boolean;
  /** True once a submit succeeded, until the values change again. */
  submitted: boolean;
}

export interface CreateFormOptions<R> {
  fields: readonly FieldSchema[];
  /** The record being edited. Leave out for a create form. */
  initial?: FormValues;
  /** Receives every value on create and only changed values on update. */
  submit: (values: FormValues, mode: "create" | "update") => Promise<R>;
  onSuccess?: (result: R) => void;
}

export interface FormController<R> {
  store: Store<FormState>;
  mode: "create" | "update";
  /** Sets a raw input value (string, boolean, or string[]); it is coerced by field type. */
  setValue(name: string, raw: unknown): void;
  /** Returns the field errors and stores them. */
  validate(): FieldErrors;
  /** Validates, sends, and maps server errors back onto fields. Resolves to the result or undefined. */
  submit(): Promise<R | undefined>;
  reset(values?: FormValues): void;
}

export function createForm<R = unknown>(options: CreateFormOptions<R>): FormController<R> {
  const mode = options.initial ? "update" : "create";
  let initial: FormValues = {};
  const startValues = (source?: FormValues): FormValues => {
    const values: FormValues = {};
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
  const store = createStore<FormState>({ values: initial, errors: {}, formError: null, submitting: false, submitted: false });
  const byName = new Map(options.fields.map((field) => [field.name, field]));
  const shown = options.fields.map((field) => field.name);

  const outgoing = (): FormValues => {
    const values = store.get().values;
    if (mode === "update") {
      return changedFields(initial, values);
    }
    const out: FormValues = {};
    for (const [key, value] of Object.entries(values)) {
      if (value !== null && value !== undefined) {
        out[key] = value;
      }
    }
    return out;
  };

  const validate = (): FieldErrors => {
    const values = mode === "update" ? { ...initial, ...store.get().values } : store.get().values;
    const errors = validateRecord(options.fields, values, mode);
    store.set((state) => ({ ...state, errors }));
    return errors;
  };

  // Methods never use this, so they can be passed around detached.
  return {
    store,
    mode,
    setValue(name, raw) {
      const field = byName.get(name);
      const value = field ? coerceValue(field, raw) : raw;
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
        return undefined;
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
        const mapped = fieldErrorsFrom(error, shown);
        store.set((state) => ({ ...state, submitting: false, errors: mapped.fields, formError: mapped.message ?? null }));
        return undefined;
      }
    },
    reset(values) {
      initial = startValues(values ?? options.initial);
      store.set({ values: initial, errors: {}, formError: null, submitting: false, submitted: false });
    },
  };
}
