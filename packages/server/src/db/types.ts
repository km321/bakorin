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
  return value;
}
