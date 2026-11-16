/** @jsxImportSource react */
import { type ReactNode } from "react";
import { type UseRecordFormOptions } from "./hooks.ts";
export interface RecordFormProps<R> extends UseRecordFormOptions<R> {
    submitLabel?: string;
    /** Clear the form after a create. Default true. */
    resetOnCreate?: boolean;
    /** Message after saving. Default "Saved". Set to null for none. */
    successMessage?: string | null;
    labels?: Record<string, string>;
    hints?: Record<string, ReactNode>;
    /** Choices for relation fields, by field name. Without them the form loads up to 100 related records. */
    relationOptions?: Record<string, {
        value: string;
        label: string;
    }[]>;
    className?: string;
    /** Text fields to show as multi line text areas. */
    multiline?: readonly string[];
    /** File fields: accepted types for the picker, for example { cover: "image/*" }. */
    accept?: Record<string, string>;
    /** Use a collection's create and update so lists change at once. */
    collection?: {
        create: (body: never) => Promise<unknown>;
        update: (id: string, body: never) => Promise<unknown>;
    };
    children?: ReactNode;
}
/** A create or edit form built from the schema: labels, input types, validation, and server errors per field. */
export declare function RecordForm<R = Record<string, unknown>>(props: RecordFormProps<R>): import("react").JSX.Element;
