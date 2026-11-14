import { sql } from "kysely";
import {
  assertPlanApplyable,
  deserializeAst,
  diffSchemas,
  quoteChecked,
  serializeAst,
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

function indexName(entity: string, field: string, unique: boolean): string {
  return `_bakorin_${unique ? "uidx" : "idx"}_${entity}_${field}`;
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
          `create unique index if not exists ${quoteChecked(indexName(entity.name, field.name, true))} on ${quoteChecked(entity.name)} (${quoteChecked(field.name)})`,
        )
        .execute(db);
    } else if (field.indexed) {
      await sql
        .raw(
          `create index if not exists ${quoteChecked(indexName(entity.name, field.name, false))} on ${quoteChecked(entity.name)} (${quoteChecked(field.name)})`,
        )
        .execute(db);
    }
  }
}

async function applyAuto(db: BakorinDb, dialect: DialectName, plan: DiffPlan): Promise<void> {
  for (const change of plan.auto) {
    switch (change.kind) {
      case "add_entity": {
        if (!(await tableExists(db, dialect, change.entity.name))) {
          await sql.raw(createTableSql(dialect, change.entity)).execute(db);
        }
        await addIndexes(db, change.entity);
        break;
      }
      case "add_field": {
        if (await columnExists(db, dialect, change.entity, change.field.name)) {
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
        await sql
          .raw(
            `create index if not exists ${quoteChecked(indexName(change.entity, change.field, false))} on ${quoteChecked(change.entity)} (${quoteChecked(change.field)})`,
          )
          .execute(db);
        break;
      }
      default: {
        const _never: never = change;
        return _never;
      }
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
      default: {
        const _never: never = change;
        return _never;
      }
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

async function withLock<T>(db: BakorinDb, dialect: DialectName, fn: () => Promise<T>): Promise<T> {
  if (dialect === "postgres") {
    await sql`select pg_advisory_lock(hashtext('bakorin.migrate'))`.execute(db);
    try {
      return await fn();
    } finally {
      await sql`select pg_advisory_unlock(hashtext('bakorin.migrate'))`.execute(db);
    }
  }
  await sql`begin immediate`.execute(db);
  try {
    const result = await fn();
    await sql`commit`.execute(db);
    return result;
  } catch (error) {
    await sql`rollback`.execute(db);
    throw error;
  }
}

export async function migrateToSchema(db: BakorinDb, ast: SchemaAST): Promise<MigrateResult> {
  await ensureSystemTables(db, ast.runtime.dialect);
  return withLock(db, ast.runtime.dialect, async () => {
    const stored = await metaGet(db, "schema_ast");
    const previous = stored ? deserializeAst(stored) : null;
    const plan = diffSchemas(previous, ast);
    assertPlanApplyable(plan);
    await applyAuto(db, ast.runtime.dialect, plan);
    await applySafe(db, ast.runtime.dialect, plan);
    await applyDeprecate(db, plan);
    await metaSet(db, "schema_ast", serializeAst(ast));
    await metaSet(db, "applied_at", new Date().toISOString());
    return { plan, applied: true };
  });
}

export async function loadStoredAst(db: BakorinDb): Promise<SchemaAST | null> {
  const stored = await metaGet(db, "schema_ast");
  return stored ? deserializeAst(stored) : null;
}
