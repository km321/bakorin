import { type FieldErrors, type FormValues } from "../headless/form.ts";
import { type CollectionState } from "../headless/collection.ts";
import { type EntitySchema, type FieldSchema } from "../headless/schema.ts";
export declare function escapeHtml(value: unknown): string;
export interface RenderFieldOptions {
    idPrefix: string;
    value?: unknown;
    error?: string;
    label?: string;
    hint?: string;
    autocomplete?: string;
    options?: {
        value: string;
        label: string;
    }[];
}
export declare function renderField(field: FieldSchema, options: RenderFieldOptions): string;
export declare function renderAlert(message: string | null | undefined, tone?: "error" | "success"): string;
export interface RenderFormOptions {
    idPrefix: string;
    fields: readonly FieldSchema[];
    values?: FormValues;
    errors?: FieldErrors;
    formError?: string | null;
    success?: string | null;
    submitLabel: string;
    /** Where the form posts without JavaScript. Default: the same page. */
    action?: string;
    className: string;
    labels?: Record<string, string>;
    hints?: Record<string, string>;
    autocomplete?: Record<string, string>;
    relationOptions?: Record<string, {
        value: string;
        label: string;
    }[]>;
    /** Extra HTML after the button (links). Trusted: pass only your own markup. */
    footer?: string;
    /** Hidden inputs, for example _action or id. */
    hidden?: Record<string, string>;
}
export declare function renderForm(options: RenderFormOptions): string;
export declare function signInFields(identityField?: string): FieldSchema[];
export interface DropzoneOptions {
    idPrefix: string;
    inputId?: string;
    describedBy?: string;
    /** Hidden input that holds the uploaded file id. */
    name?: string;
    value?: unknown;
    label?: string;
    accept?: string;
    maxBytes?: number;
    hint?: string;
    basePath?: string;
}
export declare function renderDropzone(options: DropzoneOptions): string;
export interface TableConfig {
    entity: string;
    caption: string;
    hideCaption?: boolean;
    columns: {
        field: string;
        label: string;
        sortable: boolean;
        meta?: FieldSchema;
    }[];
    display: string;
    toggle: string[];
    deletable: boolean;
    confirmDelete: string | null;
    emptyText: string;
    /** For links that work without JavaScript: ?page= and ?sort= on this path. */
    path?: string;
}
export declare function tableConfig(entity: string, schema: EntitySchema | undefined, options?: {
    columns?: (string | {
        field: string;
        label?: string;
        sortable?: boolean;
    })[];
    caption?: string;
    hideCaption?: boolean;
    toggle?: string[];
    deletable?: boolean;
    confirmDelete?: string | null;
    emptyText?: string;
    path?: string;
}): TableConfig;
type TableState = Pick<CollectionState<Record<string, unknown>>, "items" | "total" | "limit" | "offset" | "sort" | "error" | "loading">;
export declare function renderTableBody(config: TableConfig, state: TableState): string;
export declare function renderTableHead(config: TableConfig, state: TableState): string;
export declare function renderPager(config: TableConfig, state: TableState): string;
/** The whole table. The element swaps the head, body, and pager as the state changes. */
export declare function renderTable(config: TableConfig, state: TableState, idPrefix: string): string;
export declare function renderLiveStatus(live: string): string;
export declare function renderListItems(items: Record<string, unknown>[], display: string, emptyText: string): string;
/** Safe JSON for a script type="application/json" tag. */
export declare function jsonForScript(value: unknown): string;
export {};
