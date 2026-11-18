import { MAX_LINKS_PER_FIELD, type EntityAST, type FieldAST, type SchemaAST } from "@bakorin/core";
import { sanitizeRichText } from "@bakorin/sdk/richtext";

/** Largest JSON or rich text value one field accepts, measured as text. */
export const MAX_DOCUMENT_CHARS = 1_000_000;
/** Deepest nesting a JSON value may have. */
export const MAX_JSON_DEPTH = 64;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class InputError extends Error {
  constructor(
    readonly field: string,
    message: string,
  ) {
    super(message);
    this.name = "InputError";
  }
}

function asString(value: unknown): string {
  return String(value);
}

function jsonDepth(value: unknown, depth = 0): number {
  if (depth > MAX_JSON_DEPTH) {
    return depth;
  }
  if (Array.isArray(value)) {
    return value.reduce<number>((max, item) => Math.max(max, jsonDepth(item, depth + 1)), depth + 1);
  }
  if (value && typeof value === "object") {
    return Object.values(value).reduce<number>((max, item) => Math.max(max, jsonDepth(item, depth + 1)), depth + 1);
  }
  return depth;
}

/**
 * A json field takes any JSON value as is: an object, a list, a string, a number, or
 * a boolean (null clears it). A string is stored as a JSON string, not parsed.
 */
function validateJson(field: FieldAST, value: unknown): unknown {
  let text: string | undefined;
  try {
    text = JSON.stringify(value);
  } catch {
    text = undefined;
  }
  if (text === undefined || (typeof value === "number" && !Number.isFinite(value))) {
    throw new InputError(field.name, `${field.name} must be valid JSON`);
  }
  if (text.length > MAX_DOCUMENT_CHARS) {
    throw new InputError(field.name, `${field.name} is too large (at most ${MAX_DOCUMENT_CHARS} characters of JSON)`);
  }
  if (jsonDepth(value) > MAX_JSON_DEPTH) {
    throw new InputError(field.name, `${field.name} is nested too deeply (at most ${MAX_JSON_DEPTH} levels)`);
  }
  // A plain copy: no prototypes, no undefined values, the same shape it will be read back in.
  return JSON.parse(text) as unknown;
}

/** Rich text is HTML, cleaned against the allowlist on every write. Clients are never trusted. */
function validateRichText(field: FieldAST, value: unknown): string {
  if (typeof value !== "string") {
    throw new InputError(field.name, `${field.name} must be a string of HTML`);
  }
  if (value.length > MAX_DOCUMENT_CHARS) {
    throw new InputError(field.name, `${field.name} is too large (at most ${MAX_DOCUMENT_CHARS} characters)`);
  }
  return sanitizeRichText(value);
}

export function validateValue(field: FieldAST, value: unknown, writing: boolean): unknown {
  if (field.relation?.many && value !== undefined) {
    // Many to many: a list of ids (null clears the links).
    if (value !== null && !Array.isArray(value)) {
      throw new InputError(field.name, `${field.name} must be a list of ids`);
    }
    const ids: string[] = [];
    const seen = new Set<string>();
    for (const item of value ?? []) {
      if (typeof item !== "string" || item.trim() === "") {
        throw new InputError(field.name, `${field.name} must be a list of ids`);
      }
      if (!seen.has(item)) {
        seen.add(item);
        ids.push(item);
      }
    }
    if (ids.length > MAX_LINKS_PER_FIELD) {
      throw new InputError(field.name, `${field.name} accepts at most ${MAX_LINKS_PER_FIELD} ids`);
    }
    if (field.required && ids.length === 0) {
      throw new InputError(field.name, `${field.name} needs at least one id`);
    }
    return ids;
  }
  if (value === undefined) {
    if (field.required && field.defaultValue === undefined && writing) {
      throw new InputError(field.name, `${field.name} is required`);
    }
    return undefined;
  }
  if (value === null) {
    if (field.required) {
      throw new InputError(field.name, `${field.name} is required`);
    }
    return null;
  }
  switch (field.type) {
    case "boolean":
      if (typeof value === "boolean") {
        return value;
      }
      if (value === "true" || value === "1" || value === 1) {
        return true;
      }
      if (value === "false" || value === "0" || value === 0) {
        return false;
      }
      throw new InputError(field.name, `${field.name} must be a boolean`);
    case "integer": {
      const num = typeof value === "number" ? value : Number(value);
      if (!Number.isInteger(num)) {
        throw new InputError(field.name, `${field.name} must be an integer`);
      }
      return num;
    }
    case "number": {
      const num = typeof value === "number" ? value : Number(value);
      if (!Number.isFinite(num)) {
        throw new InputError(field.name, `${field.name} must be a number`);
      }
      return num;
    }
    case "email": {
      const text = asString(value).trim();
      if (!EMAIL.test(text)) {
        throw new InputError(field.name, `${field.name} must be an email`);
      }
      return text;
    }
    case "enum": {
      const text = asString(value);
      if (!field.enumValues?.includes(text)) {
        throw new InputError(field.name, `${field.name} must be one of ${field.enumValues?.join(", ")}`);
      }
      return text;
    }
    case "date": {
      const text = asString(value);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
        throw new InputError(field.name, `${field.name} must be YYYY-MM-DD`);
      }
      return text;
    }
    case "datetime": {
      const text = asString(value);
      const time = Date.parse(text);
      if (Number.isNaN(time)) {
        throw new InputError(field.name, `${field.name} must be an ISO datetime`);
      }
      return new Date(time).toISOString();
    }
    case "json":
      return validateJson(field, value);
    case "richtext": {
      const html = validateRichText(field, value);
      if (field.required && html.trim() === "") {
        throw new InputError(field.name, `${field.name} is required`);
      }
      return html;
    }
    case "password":
    case "text":
    case "file":
    case "relation":
      return asString(value);
    default: {
      const _never: never = field.type;
      return _never;
    }
  }
}

export function parseBody(
  entity: EntityAST,
  body: Record<string, unknown>,
  mode: "create" | "update",
  skipRequired: string[] = [],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const skip = new Set(skipRequired);
  for (const field of entity.fields) {
    if (field.name === "id" || field.name === "createdAt" || field.name === "updatedAt") {
      continue;
    }
    if (!(field.name in body)) {
      if (mode === "create" && field.required && field.defaultValue === undefined && !skip.has(field.name)) {
        throw new InputError(field.name, `${field.name} is required`);
      }
      if (mode === "create" && field.defaultValue !== undefined) {
        out[field.name] =
          field.type === "richtext" || field.type === "json" ? validateValue(field, field.defaultValue, true) : field.defaultValue;
      }
      continue;
    }
    out[field.name] = validateValue(field, body[field.name], mode === "create");
  }
  return out;
}

export function publicRow(entity: EntityAST, row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of entity.fields) {
    if (field.secret) {
      continue;
    }
    if (field.name in row) {
      out[field.name] = row[field.name];
    }
  }
  return out;
}

/** Admins see private fields everywhere; a user sees their own on the auth entity. */
export function canSeePrivate(
  ast: SchemaAST,
  entity: EntityAST,
  row: Record<string, unknown> | null,
  actor: { id: string; role: string } | null,
): boolean {
  if (actor && actor.role === ast.auth.adminRole) {
    return true;
  }
  return Boolean(actor && row && entity.name === ast.auth.entity && String(row.id) === actor.id);
}

/**
 * The API view of a row for one reader: secret fields are always removed, and
 * private fields (by default the auth identity, role and emailVerified) are removed
 * unless the reader is an admin or the row is the reader's own user record.
 */
export function visibleRow(
  ast: SchemaAST,
  entity: EntityAST,
  row: Record<string, unknown>,
  actor: { id: string; role: string } | null,
): Record<string, unknown> {
  const out = publicRow(entity, row);
  if (canSeePrivate(ast, entity, row, actor)) {
    return out;
  }
  for (const field of entity.fields) {
    if (field.private) {
      delete out[field.name];
    }
  }
  for (const key of Object.keys(row)) {
    if (key === "$expand") {
      out[key] = row[key];
    }
  }
  return out;
}
