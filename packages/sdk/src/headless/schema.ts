/**
 * The shape of the bakorinSchema constant that `bakorin types` writes next to the
 * entity interfaces. RecordForm and DataTable read it to build fields and columns.
 */
export type FieldTypeName =
  | "text"
  | "email"
  | "password"
  | "number"
  | "integer"
  | "boolean"
  | "enum"
  | "date"
  | "datetime"
  | "relation"
  | "file";

export interface FieldSchema {
  name: string;
  type: FieldTypeName;
  required?: boolean;
  enumValues?: readonly string[];
  relation?: { to: string; many?: boolean };
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
  auth?: { entity: string; identityField: string; passwordField: string };
}

/** "dueDate" -> "Due date", "ownerId" -> "Owner". */
export function fieldLabel(name: string): string {
  const base = name.length > 2 && name.endsWith("Id") ? name.slice(0, -2) : name;
  const words = base
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export interface FormFieldOptions {
  mode?: "create" | "update";
  /** Admins may also set writable: admin fields. */
  isAdmin?: boolean;
  /** Only these fields, in this order. */
  include?: readonly string[];
  exclude?: readonly string[];
}

/** The fields a signed in user can fill in, in schema order. */
export function formFields(entity: EntitySchema, options: FormFieldOptions = {}): FieldSchema[] {
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
    // Password changes need currentPassword, so update forms leave passwords out.
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

/** Columns worth showing in a table: everything readable except secrets and long internals. */
export function columnFields(entity: EntitySchema, include?: readonly string[]): FieldSchema[] {
  const readable = entity.fields.filter((field) => !field.secret && field.type !== "password");
  if (include) {
    return include.flatMap((name) => readable.filter((field) => field.name === name));
  }
  return readable.filter((field) => !field.system && !field.owner && !field.relation?.many);
}
