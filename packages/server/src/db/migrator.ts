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
} from "@bakorin/core";
import type { BakorinDb } from "./dialects.ts";
import { DEPRECATED_TABLE, ensureSystemTables, metaGet, metaSet } from "./system.ts";
import { sqlType } from "./types.ts";

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
    parts.push(`default ${literal(dialect, field.defaultValue)}`);
  }
  return parts.join(" ");
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
  const cols = entity.fields.map((field) => columnSql(dialect, field));
  for (const field of entity.fields) {
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
  return `create table if not exists ${quoteChecked(entity.name)} (\n  ${cols.join(",\n  ")}\n)`;
}

function indexName(entity: string, fields: string[], unique: boolean): string {
  return `_bakorin_${unique ? "uidx" : "idx"}_${entity}_${fields.join("_")}`;
}

async function tableExists(db: BakorinDb, dialect: DialectName, name: string): Promise<boolean> {
  if (dialect === "sqlite") {
    const row = await sql<{ name: string }>`select name from sqlite_master where type = 'table' and name = ${name}`.execute(
      db,
    );
    return row.rows.length > 0;
  }
  const row = await sql<{ present: boolean }>`
    select exists (
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = ${name}
    ) as present
  `.execute(db);
  return Boolean(row.rows[0]?.present);
}

async function columnExists(db: BakorinDb, dialect: DialectName, table: string, column: string): Promise<boolean> {
  if (dialect === "sqlite") {
    const result = await sql.raw(`pragma table_info(${quoteChecked(table)})`).execute(db);
    return (result.rows as Array<{ name: string }>).some((row) => row.name === column);
  }
  const row = await sql<{ present: boolean }>`
    select exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = ${table} and column_name = ${column}
    ) as present
  `.execute(db);
  return Boolean(row.rows[0]?.present);
}

async function addIndexes(db: BakorinDb, entity: EntityAST): Promise<void> {
  for (const field of entity.fields) {
    if (field.name === "id") {
      continue;
    }
    if (field.unique) {
      await sql
        .raw(
          `create unique index if not exists ${quoteChecked(indexName(entity.name, [field.name], true))} on ${quoteChecked(entity.name)} (${quoteChecked(field.name)})`,
        )
        .execute(db);
    } else if (field.indexed) {
      await sql
        .raw(
          `create index if not exists ${quoteChecked(indexName(entity.name, [field.name], false))} on ${quoteChecked(entity.name)} (${quoteChecked(field.name)})`,
        )
        .execute(db);
    }
  }
  for (const fields of entity.indexes ?? []) {
    if (fields.length === 0) {
      continue;
    }
    const cols = fields.map((field) => quoteChecked(field)).join(", ");
    await sql
      .raw(
        `create index if not exists ${quoteChecked(indexName(entity.name, fields, false))} on ${quoteChecked(entity.name)} (${cols})`,
      )
      .execute(db);
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
        await addIndexes(db, change.entity);
        break;
      }
      case "add_field": {
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
          change.field.required && change.field.defaultValue !== undefined
            ? ` not null default ${literal(dialect, change.field.defaultValue)}`
            : "";
        await sql
          .raw(
            `alter table ${quoteChecked(change.entity)} add column ${quoteChecked(change.field.name)} ${sqlType(dialect, change.field)}${extra}`,
          )
          .execute(db);
        if (change.field.unique || change.field.indexed) {
          await addIndexes(db, {
            name: change.entity,
            fields: [change.field],
          } as EntityAST);
        }
        break;
      }
      case "add_index": {
        const cols = change.fields.map((field) => quoteChecked(field)).join(", ");
        await sql
          .raw(
            `create index if not exists ${quoteChecked(indexName(change.entity, change.fields, false))} on ${quoteChecked(change.entity)} (${cols})`,
          )
          .execute(db);
        break;
      }
      default:
        break;
    }
  }
}

async function applySafe(db: BakorinDb, dialect: DialectName, plan: DiffPlan): Promise<void> {
  for (const change of plan.safe) {
    switch (change.kind) {
      case "rename_field": {
        if (dialect === "sqlite") {
          await sql
            .raw(
              `alter table ${quoteChecked(change.entity)} rename column ${quoteChecked(change.from)} to ${quoteChecked(change.to)}`,
            )
            .execute(db);
        } else {
          await sql
            .raw(
              `alter table ${quoteChecked(change.entity)} rename column ${quoteChecked(change.from)} to ${quoteChecked(change.to)}`,
            )
            .execute(db);
        }
        break;
      }
      case "rename_entity": {
        await sql.raw(`alter table ${quoteChecked(change.from)} rename to ${quoteChecked(change.to)}`).execute(db);
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
 */
async function withLock<T>(db: BakorinDb, dialect: DialectName, fn: (trx: BakorinDb) => Promise<T>): Promise<T> {
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
    await applySafe(trx, ast.runtime.dialect, plan);
    await applyDeprecate(trx, plan);
    await metaSet(trx, "schema_ast", serializeAst(ast));
    await metaSet(trx, "applied_at", new Date().toISOString());
    return { plan, applied: true, ...(backup ? { backup } : {}) };
  });
}

export async function loadStoredAst(db: BakorinDb): Promise<SchemaAST | null> {
  const stored = await metaGet(db, "schema_ast");
  return stored ? deserializeAst(stored) : null;
}
