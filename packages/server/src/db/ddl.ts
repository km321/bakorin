import { sql } from "kysely";
import type { DialectName } from "@bakorin/core";
import { MYSQL_TABLE_OPTIONS, type BakorinDb } from "./dialects.ts";
import { MYSQL_KEY_TEXT, MYSQL_LONG_TEXT } from "./types.ts";

/**
 * Small DDL helpers that hide the differences between SQLite, Postgres and
 * MySQL/MariaDB: table options, "if not exists" on indexes (MySQL has none),
 * index prefix lengths on long text, and catalog lookups.
 */

/** Appended to every create table: utf8mb4 with a binary collation on MySQL and MariaDB. */
export function tableOptions(dialect: DialectName): string {
  return dialect === "mysql" ? ` ${MYSQL_TABLE_OPTIONS}` : "";
}

/** A text column that is a key, unique, or indexed. */
export function keyTextType(dialect: DialectName): string {
  return dialect === "mysql" ? MYSQL_KEY_TEXT : "text";
}

/** A text column of any length that is never indexed. */
export function longTextType(dialect: DialectName): string {
  return dialect === "mysql" ? MYSQL_LONG_TEXT : "text";
}

/** Whole numbers that can be epoch milliseconds or byte counts. */
export function bigIntType(dialect: DialectName): string {
  return dialect === "postgres" || dialect === "mysql" ? "bigint" : "integer";
}

/** MySQL and MariaDB limit identifiers to 64 characters. */
const MYSQL_MAX_IDENT = 64;

function fnv(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/** The name an index really has on this dialect (long names are shortened with a hash on MySQL). */
export function physicalIndexName(dialect: DialectName, name: string): string {
  if (dialect !== "mysql" || name.length <= MYSQL_MAX_IDENT) {
    return name;
  }
  return `${name.slice(0, MYSQL_MAX_IDENT - 9)}_${fnv(name)}`;
}

function quoteIdent(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`refusing to quote unsafe identifier ${JSON.stringify(name)}`);
  }
  return `"${name}"`;
}

/** Bytes of index key InnoDB allows (DYNAMIC rows): 3072. 191 utf8mb4 characters is 764 bytes. */
const MYSQL_TEXT_PREFIX = 191;

export async function mysqlColumnTypes(db: BakorinDb, table: string): Promise<Map<string, string>> {
  const result = await sql<{ name: string; type: string }>`
    select column_name as name, data_type as type from information_schema.columns
    where table_schema = database() and table_name = ${table}
  `.execute(db);
  return new Map(result.rows.map((row) => [String(row.name), String(row.type).toLowerCase()]));
}

export async function indexExists(db: BakorinDb, dialect: DialectName, table: string, name: string): Promise<boolean> {
  if (dialect !== "mysql") {
    throw new Error("indexExists is only used on mysql");
  }
  const result = await sql<{ name: string }>`
    select index_name as name from information_schema.statistics
    where table_schema = database() and table_name = ${table} and index_name = ${physicalIndexName(dialect, name)}
    limit 1
  `.execute(db);
  return result.rows.length > 0;
}

/**
 * create [unique] index if not exists, on every dialect. On MySQL and MariaDB a
 * plain index on a longtext column indexes its first 191 characters, and MySQL
 * JSON columns (which cannot be indexed directly) are left out of the index.
 */
export async function createIndex(
  db: BakorinDb,
  dialect: DialectName,
  options: { name: string; table: string; columns: string[]; unique?: boolean },
): Promise<void> {
  const unique = options.unique ? "unique " : "";
  if (dialect !== "mysql") {
    const cols = options.columns.map(quoteIdent).join(", ");
    await sql
      .raw(`create ${unique}index if not exists ${quoteIdent(options.name)} on ${quoteIdent(options.table)} (${cols})`)
      .execute(db);
    return;
  }
  if (await indexExists(db, dialect, options.table, options.name)) {
    return;
  }
  const types = await mysqlColumnTypes(db, options.table);
  const parts: string[] = [];
  for (const column of options.columns) {
    const type = types.get(column) ?? "";
    if (type === "json") {
      continue;
    }
    if (/text|blob/.test(type)) {
      if (options.unique) {
        throw new Error(`cannot add a unique index on ${options.table}.${column}: it is long text on MySQL`);
      }
      parts.push(`${quoteIdent(column)}(${MYSQL_TEXT_PREFIX})`);
    } else {
      parts.push(quoteIdent(column));
    }
  }
  if (parts.length === 0) {
    return;
  }
  try {
    await sql
      .raw(`create ${unique}index ${quoteIdent(physicalIndexName(dialect, options.name))} on ${quoteIdent(options.table)} (${parts.join(", ")})`)
      .execute(db);
  } catch (error) {
    // ER_DUP_KEYNAME: another instance created it between the check and here.
    if ((error as { errno?: number }).errno !== 1061) {
      throw error;
    }
  }
}

export async function tableExists(db: BakorinDb, dialect: DialectName, name: string): Promise<boolean> {
  if (dialect === "sqlite") {
    const row = await sql<{ name: string }>`select name from sqlite_master where type = 'table' and name = ${name}`.execute(db);
    return row.rows.length > 0;
  }
  const schema = dialect === "mysql" ? sql`database()` : sql`'public'`;
  const row = await sql<{ name: string }>`
    select table_name as name from information_schema.tables
    where table_schema = ${schema} and table_name = ${name}
  `.execute(db);
  return row.rows.length > 0;
}

export async function tableColumnNames(db: BakorinDb, dialect: DialectName, table: string): Promise<Set<string>> {
  if (dialect === "sqlite") {
    const result = await sql.raw(`pragma table_info(${quoteIdent(table)})`).execute(db);
    return new Set((result.rows as Array<{ name: string }>).map((row) => row.name));
  }
  const schema = dialect === "mysql" ? sql`database()` : sql`'public'`;
  const result = await sql<{ name: string }>`
    select column_name as name from information_schema.columns
    where table_schema = ${schema} and table_name = ${table}
  `.execute(db);
  return new Set(result.rows.map((row) => String(row.name)));
}

/**
 * `escape '\'` for LIKE. MySQL and MariaDB read a backslash inside a string
 * literal as an escape, so the literal there is written '\\'.
 */
export function likeEscape(dialect: DialectName) {
  return dialect === "mysql" ? sql.raw(`escape '\\\\'`) : sql.raw(`escape '\\'`);
}

/** The SQL type name to cast a value to text: char on MySQL and MariaDB, text elsewhere. */
export function textCast(dialect: DialectName) {
  return sql.raw(dialect === "mysql" ? "char" : "text");
}
