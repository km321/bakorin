import type { BakorinRequestError } from "../index.ts";
import { type FieldSchema } from "./schema.ts";
import { type Store } from "./store.ts";
export type FieldErrors = Record<string, string>;
export type FormValues = Record<string, unknown>;
/**
 * Turns what an input holds (always a string, or a boolean for checkboxes) into
 * the value the API expects. Empty optional inputs become null on update and are
 * left out on create, which matches how the server treats them.
 */
export declare function coerceValue(field: FieldSchema, raw: unknown): unknown;
/** Formats an API value for an input's value attribute. */
export declare function inputValue(field: FieldSchema, value: unknown): string;
/** The same checks the server runs, so most mistakes show before a round trip. */
export declare function validateField(field: FieldSchema, value: unknown, mode?: "create" | "update"): string | undefined;
/** Validates every field. Returns an empty object when the values are fine. */
export declare function validateRecord(fields: readonly FieldSchema[], values: FormValues, mode?: "create" | "update"): FieldErrors;
/** Only the values that differ from initial, for a PATCH that leaves everything else alone. */
export declare function changedFields(initial: FormValues, values: FormValues): FormValues;
/** True for errors the SDK throws for a server answer. Works across bundles, unlike instanceof. */
export declare function isRequestError(error: unknown): error is BakorinRequestError;
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
export declare function fieldErrorsFrom(error: unknown, shownFields?: readonly string[]): ErrorMapping;
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
export declare function createForm<R = unknown>(options: CreateFormOptions<R>): FormController<R>;
