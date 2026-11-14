import { IdentError } from "./errors.ts";

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const RESERVED_PREFIX = "_bakorin";

const SQL_KEYWORDS = new Set([
  "select",
  "insert",
  "update",
  "delete",
  "from",
  "where",
  "table",
  "index",
  "drop",
  "alter",
  "create",
  "join",
  "union",
  "grant",
  "revoke",
  "pragma",
  "vacuum",
]);

export function assertIdent(name: string, kind: "entity" | "field" | "enum"): string {
  if (!IDENT.test(name)) {
    throw new IdentError(`${kind} name ${JSON.stringify(name)} is not a valid identifier`);
  }
  if (name.toLowerCase().startsWith(RESERVED_PREFIX)) {
    throw new IdentError(`${kind} name ${JSON.stringify(name)} uses the reserved _bakorin prefix`);
  }
  if (SQL_KEYWORDS.has(name.toLowerCase())) {
    throw new IdentError(`${kind} name ${JSON.stringify(name)} is a reserved SQL keyword`);
  }
  return name;
}

export function isIdent(name: string): boolean {
  return IDENT.test(name) && !name.toLowerCase().startsWith(RESERVED_PREFIX);
}

export function quoteIdent(name: string): string {
  assertIdent(name, "field");
  return `"${name.replaceAll('"', '""')}"`;
}

/** Quote a name that has already been validated from the AST (includes system tables). */
export function quoteChecked(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new IdentError(`refusing to quote unsafe identifier ${JSON.stringify(name)}`);
  }
  return `"${name}"`;
}
