/** @jsxImportSource react */
import { type ReactNode } from "react";
import { type FieldSchema } from "../headless/schema.ts";
export declare function cx(...names: (string | false | null | undefined)[]): string;
export interface FieldProps {
    field: FieldSchema;
    value: unknown;
    error?: string;
    label?: string;
    hint?: ReactNode;
    onChange: (raw: unknown) => void;
    /** For relation fields: the choices. Without them the field takes an id. */
    options?: {
        value: string;
        label: string;
    }[] | null;
    autoComplete?: string;
    disabled?: boolean;
    /** Replaces the input, for file fields and custom widgets. Gets the ids for labelling. */
    children?: (ids: {
        inputId: string;
        describedBy: string | undefined;
    }) => ReactNode;
}
/** One labelled input with its hint and error, wired for screen readers. */
export declare function Field({ field, value, error, label, hint, onChange, options, autoComplete, disabled, children }: FieldProps): import("react").JSX.Element;
export declare function FormAlert({ message, tone }: {
    message: string | null | undefined;
    tone?: "error" | "success";
}): import("react").JSX.Element;
