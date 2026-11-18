import type { DialectName, FieldAST } from "@bakorin/core";

export function sqlType(dialect: DialectName, field: FieldAST): string {
  switch (field.type) {
    case "boolean":
      return dialect === "postgres" ? "boolean" : "integer";
    case "integer":
      return "integer";
    case "number":
      return dialect === "postgres" ? "double precision" : "real";
    case "date":
      return dialect === "postgres" ? "date" : "text";
    case "datetime":
      return dialect === "postgres" ? "timestamptz" : "text";
    case "json":
      // SQLite has no JSON column type: the text is checked as JSON before it is written.
      return dialect === "postgres" ? "jsonb" : "text";
    default:
      return "text";
  }
}

export function encodeValue(dialect: DialectName, field: FieldAST | undefined, value: unknown): unknown {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (!field) {
    return value;
  }
  switch (field.type) {
    case "boolean":
      if (dialect === "postgres") {
        return Boolean(value);
      }
      return value === true || value === 1 || value === "true" || value === "1" ? 1 : 0;
    case "integer":
      return Number.parseInt(String(value), 10);
    case "number":
      return Number(value);
    case "datetime":
    case "date":
      return typeof value === "string" ? value : new Date(String(value)).toISOString();
    case "json":
      // The JSON text on both dialects. Postgres casts the parameter to jsonb.
      return JSON.stringify(value);
    default:
      return value;
  }
}

export function decodeValue(field: FieldAST | undefined, value: unknown): unknown {
  if (value === undefined || value === null || !field) {
    return value;
  }
  if (field.type === "boolean") {
    return value === true || value === 1 || value === "t" || value === "true" || value === "1";
  }
  if (field.type === "integer" || field.type === "number") {
    return Number(value);
  }
  if (field.type === "json") {
    // Both dialects hand back the JSON text (the pg jsonb parser is turned off in
    // dialects.ts), so a stored JSON string is never confused with an object.
    if (typeof value !== "string") {
      return value;
    }
    try {
      return JSON.parse(value) as unknown;
    } catch {
      return value;
    }
  }
  return value;
}
