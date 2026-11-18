import type { DialectName, FieldAST } from "@bakorin/core";

/**
 * MySQL and MariaDB cannot index or key a TEXT column without a prefix length, so
 * ids, single relations, unique fields, emails and enums are varchar(255). Other
 * text is longtext, and plain indexes on it use a prefix (see ddl.ts).
 */
export const MYSQL_KEY_TEXT = "varchar(255)";
export const MYSQL_LONG_TEXT = "longtext";

function mysqlType(field: FieldAST): string {
  switch (field.type) {
    case "boolean":
      return "boolean";
    case "integer":
      return "integer";
    case "number":
      return "double";
    case "date":
      return "date";
    case "datetime":
      // ISO 8601 text, the same as SQLite: MySQL DATETIME has no time zone and
      // MariaDB rejects the offset in 2024-01-01T00:00:00.000Z.
      return "varchar(64)";
    case "json":
      // JSON on MySQL (validated, binary). On MariaDB JSON is longtext with a json_valid check.
      return "json";
    default:
      if (field.name === "id" || (field.relation && !field.relation.many) || field.unique || field.type === "email" || field.type === "enum") {
        return MYSQL_KEY_TEXT;
      }
      return MYSQL_LONG_TEXT;
  }
}

/** True when a mysql column of this type needs `default (expr)` instead of a plain literal. */
export function mysqlNeedsExpressionDefault(type: string): boolean {
  return /text|json|blob/i.test(type);
}

export function sqlType(dialect: DialectName, field: FieldAST): string {
  if (dialect === "mysql") {
    return mysqlType(field);
  }
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
      // The JSON text on every dialect. Postgres casts the parameter to jsonb, MySQL to JSON.
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
    // Every dialect hands back the JSON text (the pg jsonb parser is turned off and
    // mysql2 runs with jsonStrings in dialects.ts), so a stored JSON string is
    // never confused with an object.
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
