import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Database, type SQLQueryBindings } from "bun:sqlite";
import {
  CompiledQuery,
  Kysely,
  PostgresDialect,
  SqliteAdapter,
  SqliteIntrospector,
  SqliteQueryCompiler,
  type DatabaseConnection,
  type Dialect,
  type Driver,
  type QueryResult,
} from "kysely";
import { Pool, types as pgTypes } from "pg";

pgTypes.setTypeParser(1082, (value) => value);
pgTypes.setTypeParser(1114, (value) => value);
pgTypes.setTypeParser(1184, (value) => value);
// jsonb comes back as text, the same as SQLite, and decodeValue parses it.
pgTypes.setTypeParser(3802, (value) => value);

export type BakorinDb = Kysely<Record<string, Record<string, unknown>>>;

class BunSqliteConnection implements DatabaseConnection {
  constructor(private readonly db: Database) {}

  async executeQuery<R>(compiled: { sql: string; parameters: readonly unknown[] }): Promise<QueryResult<R>> {
    const stmt = this.db.prepare(compiled.sql);
    const isSelect = /^\s*(select|pragma|with)\b/i.test(compiled.sql);
    if (isSelect) {
      const rows = stmt.all(...(compiled.parameters as SQLQueryBindings[])) as R[];
      return { rows };
    }
    const result = stmt.run(...(compiled.parameters as SQLQueryBindings[]));
    return {
      rows: [],
      numAffectedRows: BigInt(result.changes),
      insertId: BigInt(result.lastInsertRowid),
    };
  }

  async *streamQuery(): AsyncIterableIterator<QueryResult<never>> {
    throw new Error("sqlite query streaming is not supported");
  }
}

/**
 * One SQLite handle is shared by the whole process, so a transaction must own it
 * until it commits: otherwise another request's statements would run inside it, or
 * try to begin a second one. Kysely acquires a connection per query and holds it
 * for a whole transaction, so a small FIFO mutex here serializes correctly.
 */
class ConnectionMutex {
  private locked = false;
  private readonly waiting: Array<() => void> = [];

  async lock(): Promise<void> {
    if (!this.locked) {
      this.locked = true;
      return;
    }
    await new Promise<void>((resolve) => this.waiting.push(resolve));
  }

  unlock(): void {
    const next = this.waiting.shift();
    if (next) {
      next();
      return;
    }
    this.locked = false;
  }
}

class BunSqliteDriver implements Driver {
  private readonly mutex = new ConnectionMutex();
  private readonly connection: BunSqliteConnection;

  constructor(private readonly db: Database) {
    this.connection = new BunSqliteConnection(db);
  }

  async init(): Promise<void> {}

  async acquireConnection(): Promise<DatabaseConnection> {
    await this.mutex.lock();
    return this.connection;
  }

  async beginTransaction(connection: DatabaseConnection): Promise<void> {
    await connection.executeQuery(CompiledQuery.raw("begin immediate"));
  }

  async commitTransaction(connection: DatabaseConnection): Promise<void> {
    await connection.executeQuery(CompiledQuery.raw("commit"));
  }

  async rollbackTransaction(connection: DatabaseConnection): Promise<void> {
    await connection.executeQuery(CompiledQuery.raw("rollback"));
  }

  async releaseConnection(): Promise<void> {
    this.mutex.unlock();
  }

  async destroy(): Promise<void> {
    this.db.close();
  }
}

class BunSqliteDialect implements Dialect {
  constructor(private readonly db: Database) {}
  createDriver(): Driver {
    return new BunSqliteDriver(this.db);
  }
  createQueryCompiler() {
    return new SqliteQueryCompiler();
  }
  createAdapter() {
    return new SqliteAdapter();
  }
  createIntrospector(db: Kysely<unknown>) {
    return new SqliteIntrospector(db);
  }
}

export function openSqlite(path: string): { db: BakorinDb; raw: Database } {
  mkdirSync(dirname(path), { recursive: true });
  const raw = new Database(path, { create: true });
  raw.exec("pragma journal_mode = WAL");
  raw.exec("pragma foreign_keys = ON");
  raw.exec("pragma busy_timeout = 5000");
  const db = new Kysely<Record<string, Record<string, unknown>>>({
    dialect: new BunSqliteDialect(raw),
  });
  return { db, raw };
}

export function openPostgres(url: string): { db: BakorinDb; pool: Pool } {
  const pool = new Pool({ connectionString: url, max: 8 });
  // An idle client can die when Postgres restarts, fails over, or terminates the
  // backend. pg emits that on the pool, and an unhandled 'error' event would
  // take the whole process down. The pool replaces the client on next use.
  pool.on("error", (error) => {
    console.error(`[bakorin] postgres idle connection error: ${error instanceof Error ? error.message : String(error)}`);
  });
  const db = new Kysely<Record<string, Record<string, unknown>>>({
    dialect: new PostgresDialect({ pool }),
  });
  return { db, pool };
}

function assertDbName(name: string): string {
  if (!/^[a-z][a-z0-9_]+$/.test(name)) {
    throw new Error(`refusing to create database ${JSON.stringify(name)}`);
  }
  return name;
}

export function postgresUrlWithDatabase(adminUrl: string, name: string): string {
  const parsed = new URL(adminUrl);
  parsed.pathname = `/${assertDbName(name)}`;
  return parsed.toString();
}

export async function createPostgresDatabase(adminUrl: string, name: string): Promise<string> {
  assertDbName(name);
  const pool = new Pool({ connectionString: adminUrl });
  await pool.query(`create database ${name}`);
  await pool.end();
  return postgresUrlWithDatabase(adminUrl, name);
}

export async function dropPostgresDatabase(adminUrl: string, name: string): Promise<void> {
  assertDbName(name);
  const pool = new Pool({ connectionString: adminUrl });
  await pool.query(`drop database if exists ${name} with (force)`);
  await pool.end();
}
