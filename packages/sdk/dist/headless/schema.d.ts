/**
 * The shape of the bakorinSchema constant that `bakorin types` writes next to the
 * entity interfaces. RecordForm and DataTable read it to build fields and columns.
 */
export type FieldTypeName = "text" | "email" | "password" | "number" | "integer" | "boolean" | "enum" | "date" | "datetime" | "relation" | "file" | "json" | "richtext";
export interface FieldSchema {
    name: string;
    type: FieldTypeName;
    required?: boolean;
    enumValues?: readonly string[];
    relation?: {
        to: string;
        many?: boolean;
    };
    /** "any" (default), "admin" (only admins may set it), or "none" (server managed). */
    writable?: "any" | "admin" | "none";
    /** Never returned by the API (passwords, tokens). */
    secret?: boolean;
    /** Left out of responses for ordinary users. */
    private?: boolean;
    /** Set by the server from the signed in user (owner fields). Forms skip it. */
    owner?: boolean;
    /** id, createdAt, updatedAt. */
    system?: boolean;
    description?: string;
    defaultValue?: unknown;
    /** Shortest accepted value. Passwords default to 8 (the server's rule); sign in forms set 0. */
    minLength?: number;
    /** Show a text field as a multi line text area (bodies, descriptions). A display hint only. */
    multiline?: boolean;
}
export interface EntitySchema {
    name: string;
    /** Field shown when a record is referenced (relation pickers, list rows). */
    display: string;
    fields: readonly FieldSchema[];
}
export interface AppSchema {
    entities: Readonly<Record<string, EntitySchema>>;
    auth?: {
        entity: string;
        identityField: string;
        passwordField: string;
    };
}
/** "dueDate" -> "Due date", "ownerId" -> "Owner". */
export declare function fieldLabel(name: string): string;
export interface FormFieldOptions {
    mode?: "create" | "update";
    /** Admins may also set writable: admin fields. */
    isAdmin?: boolean;
    /** Only these fields, in this order. */
    include?: readonly string[];
    exclude?: readonly string[];
}
/** The fields a signed in user can fill in, in schema order. */
export declare function formFields(entity: EntitySchema, options?: FormFieldOptions): FieldSchema[];
/** Columns worth showing in a table: everything readable except secrets and long internals. */
export declare function columnFields(entity: EntitySchema, include?: readonly string[]): FieldSchema[];
