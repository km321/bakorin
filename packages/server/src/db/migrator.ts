import { sql } from "kysely";
import {
  assertPlanApplyable,
  DestructiveChangeError,
  describeChange,
  destructiveCode,
  deserializeAst,
  diffSchemas,
  needsConfirmation,
  quoteChecked,
  serializeAst,
  touchesExistingData,
  type DialectName,
  type DiffPlan,
  type EntityAST,
  type FieldAST,
  type SchemaAST,
  columnFields,
  joinTableName,
} from "@bakorin/core";
import { ensureLinkTables, renameLinkTable } from "../crud/links.ts";
import { isMysqlDb, type BakorinDb } from "./dialects.ts";
import { createIndex, tableColumnNames, tableExists as ddlTableExists, tableOptions } from "./ddl.ts";
import { DEPRECATED_TABLE, ensureSystemTables, metaGet, metaSet } from "./system.ts";
import { mysqlNeedsExpressionDefault, sqlType } from "./types.ts";

export interface MigrateResult {
  plan: DiffPlan;
  applied: boolean;
  /** Location of the backup taken before renames or removals, when one ran. */
  backup?: string;
}

export interface MigrateOptions {
  /**
   * Confirmation for removals. Must equal the plan's destructive code (see
   * `bakorin migrate --plan`). `true` is for tests and trusted callers only.
   */
  allowDestructive?: string | true;
  /** Runs before any rename or removal is applied, with the schema that is live now. */
  beforeChange?: (previous: SchemaAST, plan: DiffPlan) => Promise<string | undefined>;
}

export interface MigrationPlan {
  previous: SchemaAST | null;
  plan: DiffPlan;
  /** Code that confirms the removals in this plan. Empty when nothing needs confirmation. */
  confirmCode: string;
}

export async function planMigration(db: BakorinDb, ast: SchemaAST): Promise<MigrationPlan> {
  await ensureSystemTables(db, ast.runtime.dialect);
  const stored = await metaGet(db, "schema_ast");
  const previous = stored ? deserializeAst(stored) : null;
  const plan = diffSchemas(previous, ast);
  return { previous, plan, confirmCode: needsConfirmation(plan) ? destructiveCode(plan) : "" };
}

function destructiveMessage(plan: DiffPlan, code: string): string {
  const lines = plan.deprecate.map((change) => {
    const hint = (change as { hint?: string }).hint;
    return `- ${describeChange(change)}${hint ? `\n  hint: ${hint}` : ""}`;
  });
  return [
    "app.yaml removes things that exist in the database, so Bakorin did not apply it:",
    ...lines,
    "",
    "Nothing was changed. To see the full plan run: bakorin migrate --plan",
    `To apply it on purpose run: bakorin migrate --allow-destructive ${code}`,
    `or start the server once with BAKORIN_ALLOW_DESTRUCTIVE=${code}`,
    "A backup is taken automatically before the change is applied.",
  ].join("\n");
}

function assertConfirmed(plan: DiffPlan, allow: string | true | undefined): void {
  if (!needsConfirmation(plan)) {
    return;
  }
  const code = destructiveCode(plan);
  if (allow === true || (typeof allow === "string" && allow.trim() === code)) {
    return;
  }
  throw new DestructiveChangeError(destructiveMessage(plan, code), code, plan.deprecate);
}

function columnSql(dialect: DialectName, field: FieldAST): string {
  const parts = [quoteChecked(field.name), sqlType(dialect, field)];
  if (field.required && field.defaultValue === undefined && field.name !== "id") {
    parts.push("not null");
  }
  if (field.name === "id") {
    parts.push("primary key");
    parts.push("not null");
  }
  if (field.defaultValue !== undefined && field.type !== "relation") {
    parts.push(defaultClause(dialect, field));
  }
  return parts.join(" ");
}

/**
 * MySQL only takes a default on TEXT and JSON columns as an expression, so the
 * literal is wrapped in parentheses there (MySQL 8.0.13+, MariaDB 10.2+).
 */
function defaultClause(dialect: DialectName, field: FieldAST): string {
  const value = literal(dialect, defaultLiteral(field));
  return dialect === "mysql" && mysqlNeedsExpressionDefault(sqlType(dialect, field)) ? `default (${value})` : `default ${value}`;
}

/** JSON defaults are stored as their JSON text (jsonb on Postgres reads the quoted literal). */
function defaultLiteral(field: FieldAST): unknown {
  return field.type === "json" ? JSON.stringify(field.defaultValue) : field.defaultValue;
}

function literal(dialect: DialectName, value: unknown): string {
  if (typeof value === "number") {
    return String(value);
  }
  if (typeof value === "boolean") {
    if (dialect === "postgres") {
      return value ? "true" : "false";
    }
    return value ? "1" : "0";
  }
  return `'${String(value).replaceAll("'", "''")}'`;
}

function createTableSql(dialect: DialectName, entity: EntityAST): string {
  const cols = columnFields(entity).map((field) => columnSql(dialect, field));
  for (const field of columnFields(entity)) {
    if (field.relation) {
      const action =
        field.relation.onDelete === "set_null"
          ? "set null"
          : field.relation.onDelete === "cascade"
            ? "cascade"
            : "restrict";
      cols.push(
        `foreign key (${quoteChecked(field.name)}) references ${quoteChecked(field.relation.to)} (${quoteChecked("id")}) on delete ${action}`,
      );
    }
  }
  return `create table if not exists ${quoteChecked(entity.name)} (\n  ${cols.join(",\n  ")}\n)${tableOptions(dialect)}`;
}

function indexName(entity: string, fields: string[], unique: boolean): string {
  return `_bakorin_${unique ? "uidx" : "idx"}_${entity}_${fields.join("_")}`;
}

async function tableExists(db: BakorinDb, dialect: DialectName, name: string): Promise<boolean> {
  return ddlTableExists(db, dialect, name);
}

async function columnExists(db: BakorinDb, dialect: DialectName, table: string, column: string): Promise<boolean> {
  return (await tableColumnNames(db, dialect, table)).has(column);
}

async function addIndexes(db: BakorinDb, dialect: DialectName, entity: EntityAST): Promise<void> {
  for (const field of entity.fields) {
    if (field.name === "id" || field.relation?.many) {
      continue;
    }
    if (field.unique) {
      await createIndex(db, dialect, {
        name: indexName(entity.name, [field.name], true),
        table: entity.name,
        columns: [field.name],
        unique: true,
      });
    } else if (field.indexed) {
      await createIndex(db, dialect, { name: indexName(entity.name, [field.name], false), table: entity.name, columns: [field.name] });
    }
  }
  for (const fields of entity.indexes ?? []) {
    if (fields.length === 0) {
      continue;
    }
    await createIndex(db, dialect, { name: indexName(entity.name, fields, false), table: entity.name, columns: fields });
  }
}

async function applyAuto(db: BakorinDb, dialect: DialectName, plan: DiffPlan): Promise<void> {
  for (const change of plan.auto) {
    switch (change.kind) {
      case "add_entity": {
        if (!(await tableExists(db, dialect, change.entity.name))) {
          await sql.raw(createTableSql(dialect, change.entity)).execute(db);
        } else {
          await db.deleteFrom(DEPRECATED_TABLE).where("entity", "=", change.entity.name).where("kind", "=", "entity").execute();
        }
        await addIndexes(db, dialect, change.entity);
        break;
      }
      case "add_field": {
        if (change.field.relation?.many) {
          // No column: the join table is created by ensureLinkTables.
          await db.deleteFrom(DEPRECATED_TABLE).where("entity", "=", change.entity).where("field", "=", change.field.name).execute();
          break;
        }
        if (await columnExists(db, dialect, change.entity, change.field.name)) {
          // A field that was removed earlier and is added back: the column and its data are still there.
          await db
            .deleteFrom(DEPRECATED_TABLE)
            .where("entity", "=", change.entity)
            .where("field", "=", change.field.name)
            .execute();
          break;
        }
        const extra =
          change.field.required && change.field.defaultValue !== undefined ? ` not null ${defaultClause(dialect, change.field)}` : "";
        await sql
          .raw(
            `alter table ${quoteChecked(change.entity)} add column ${quoteChecked(change.field.name)} ${sqlType(dialect, change.field)}${extra}`,
          )
          .execute(db);
        if (change.field.unique || change.field.indexed) {
          await addIndexes(db, dialect, {
            name: change.entity,
            fields: [change.field],
          } as EntityAST);
        }
        break;
      }
      case "add_index": {
        await createIndex(db, dialect, {
          name: indexName(change.entity, change.fields, false),
          table: change.entity,
          columns: change.fields,
        });
        break;
      }
      default:
        break;
    }
  }
}

async function applySafe(db: BakorinDb, dialect: DialectName, plan: DiffPlan, ast: SchemaAST): Promise<void> {
  for (const change of plan.safe) {
    switch (change.kind) {
      case "rename_field": {
        if (ast.entityMap[change.entity]?.fieldMap[change.to]?.relation?.many) {
          await renameLinkTable(db, dialect, joinTableName(change.entity, change.from), joinTableName(change.entity, change.to));
          break;
        }
        // The same statement on SQLite 3.25+, Postgres, MySQL 8.0+ and MariaDB 10.5+.
        await sql
          .raw(`alter table ${quoteChecked(change.entity)} rename column ${quoteChecked(change.from)} to ${quoteChecked(change.to)}`)
          .execute(db);
        break;
      }
      case "rename_entity": {
        await sql.raw(`alter table ${quoteChecked(change.from)} rename to ${quoteChecked(change.to)}`).execute(db);
        for (const field of ast.entityMap[change.to]?.fields ?? []) {
          if (field.relation?.many) {
            const oldName = field.renameFrom ?? field.name;
            await renameLinkTable(db, dialect, joinTableName(change.from, oldName), joinTableName(change.to, oldName));
          }
        }
        break;
      }
      default:
        break;
    }
  }
}

async function applyDeprecate(db: BakorinDb, plan: DiffPlan): Promise<void> {
  const now = new Date().toISOString();
  for (const change of plan.deprecate) {
    if (change.kind === "drop_entity") {
      await db
        .insertInto(DEPRECATED_TABLE)
        .values({ kind: "entity", entity: change.entity, field: null, dropped_at: now })
        .execute();
    } else if (change.kind === "drop_field") {
      await db
        .insertInto(DEPRECATED_TABLE)
        .values({ kind: "field", entity: change.entity, field: change.field, dropped_at: now })
        .execute();
    }
  }
}

/**
 * Runs the whole migration in one transaction on one connection. Postgres has
 * transactional DDL, so a failure partway rolls back every statement and the
 * stored schema together. The transaction scoped advisory lock keeps two
 * instances from migrating at once and is released on commit or rollback.
 * SQLite takes `begin immediate` through the driver.
 *
 * MySQL and MariaDB commit implicitly on every DDL statement, so a migration
 * there is not atomic: each statement is idempotent (if not exists, catalog
 * checks) and the stored schema is written last, so a rerun after a failure
 * picks up where it stopped. A session level GET_LOCK on one connection keeps
 * two instances from migrating at once.
 */
async function withLock<T>(db: BakorinDb, dialect: DialectName, fn: (trx: BakorinDb) => Promise<T>): Promise<T> {
  if (dialect === "mysql" || isMysqlDb(db)) {
    return db.connection().execute(async (conn) => {
      const got = await sql<{ got: number | null }>`select get_lock('bakorin.migrate', 60) as got`.execute(conn);
      if (Number(got.rows[0]?.got ?? 0) !== 1) {
        throw new Error("another Bakorin instance is migrating this database (waited 60 seconds for the lock)");
      }
      try {
        return await fn(conn);
      } finally {
        await sql`select release_lock('bakorin.migrate')`.execute(conn);
      }
    });
  }
  return db.transaction().execute(async (trx) => {
    if (dialect === "postgres") {
      await sql`select pg_advisory_xact_lock(hashtext('bakorin.migrate'))`.execute(trx);
    }
    return fn(trx);
  });
}

export async function migrateToSchema(db: BakorinDb, ast: SchemaAST, options: MigrateOptions = {}): Promise<MigrateResult> {
  // Check and back up outside the lock: the backup reads the database on its own connection.
  const first = await planMigration(db, ast);
  assertPlanApplyable(first.plan);
  assertConfirmed(first.plan, options.allowDestructive);
  let backup: string | undefined;
  if (first.previous && touchesExistingData(first.plan) && options.beforeChange) {
    backup = await options.beforeChange(first.previous, first.plan);
  }
  return withLock(db, ast.runtime.dialect, async (trx) => {
    const stored = await metaGet(trx, "schema_ast");
    const previous = stored ? deserializeAst(stored) : null;
    const plan = diffSchemas(previous, ast);
    assertPlanApplyable(plan);
    assertConfirmed(plan, options.allowDestructive);
    await applyAuto(trx, ast.runtime.dialect, plan);
    await applySafe(trx, ast.runtime.dialect, plan, ast);
    await applyDeprecate(trx, plan);
    await ensureLinkTables(trx, ast);
    await metaSet(trx, "schema_ast", serializeAst(ast));
    await metaSet(trx, "applied_at", new Date().toISOString());
    return { plan, applied: true, ...(backup ? { backup } : {}) };
  });
}

export async function loadStoredAst(db: BakorinDb): Promise<SchemaAST | null> {
  const stored = await metaGet(db, "schema_ast");
  return stored ? deserializeAst(stored) : null;
}
