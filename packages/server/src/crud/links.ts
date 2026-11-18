import { sql } from "kysely";
import {
  joinTableName,
  manyFields,
  quoteChecked,
  type DialectName,
  type EntityAST,
  type FieldAST,
  type SchemaAST,
} from "@bakorin/core";
import type { BakorinDb } from "../db/dialects.ts";
import { createIndex, keyTextType, tableExists, tableOptions } from "../db/ddl.ts";
import type { Actor } from "../context.ts";
import { decideAccess } from "./policies-sql.ts";
import { applyAccess } from "./query.ts";

/**
 * Many to many relations. Each `many: true` field has a join table with
 * source_id (the record that owns the field), target_id (the linked record) and
 * position (the order the ids were sent in). Foreign keys remove links when
 * either record is deleted; deletes also clear them explicitly.
 */

export async function linkTableExists(db: BakorinDb, dialect: DialectName, name: string): Promise<boolean> {
  return tableExists(db, dialect, name);
}

/** Creates any missing join tables. Safe to run on every boot. */
export async function ensureLinkTables(db: BakorinDb, ast: SchemaAST): Promise<void> {
  for (const entity of ast.entities) {
    for (const field of manyFields(entity)) {
      const table = joinTableName(entity.name, field.name);
      const target = field.relation!.to;
      const dialect = ast.runtime.dialect;
      const id = keyTextType(dialect);
      // Inline "references" is ignored by MySQL and MariaDB, so the foreign keys are table constraints.
      await sql
        .raw(
          `create table if not exists ${quoteChecked(table)} (
  source_id ${id} not null,
  target_id ${id} not null,
  position integer not null default 0,
  primary key (source_id, target_id),
  foreign key (source_id) references ${quoteChecked(entity.name)} (id) on delete cascade,
  foreign key (target_id) references ${quoteChecked(target)} (id) on delete cascade
)${tableOptions(dialect)}`,
        )
        .execute(db);
      await createIndex(db, dialect, { name: `${table}_target`, table, columns: ["target_id"] });
    }
  }
}

/** Renames join tables after an entity or field rename, when the old table exists. */
export async function renameLinkTable(db: BakorinDb, dialect: DialectName, from: string, to: string): Promise<void> {
  if (from === to || !(await linkTableExists(db, dialect, from)) || (await linkTableExists(db, dialect, to))) {
    return;
  }
  await sql.raw(`alter table ${quoteChecked(from)} rename to ${quoteChecked(to)}`).execute(db);
}

/** Replaces the links of one record's field, keeping the order given. */
export async function writeLinks(db: BakorinDb, entity: EntityAST, field: FieldAST, recordId: string, ids: string[]): Promise<void> {
  const table = joinTableName(entity.name, field.name);
  await db.deleteFrom(table).where("source_id", "=", recordId).execute();
  if (ids.length === 0) {
    return;
  }
  for (let i = 0; i < ids.length; i += 200) {
    await db
      .insertInto(table)
      .values(ids.slice(i, i + 200).map((target, index) => ({ source_id: recordId, target_id: target, position: i + index })))
      .execute();
  }
}

/** Removes every link to or from a record that is being deleted. */
export async function deleteLinksFor(db: BakorinDb, ast: SchemaAST, entityName: string, recordId: string): Promise<void> {
  for (const entity of ast.entities) {
    for (const field of manyFields(entity)) {
      const table = joinTableName(entity.name, field.name);
      if (entity.name === entityName) {
        await db.deleteFrom(table).where("source_id", "=", recordId).execute();
      }
      if (field.relation!.to === entityName) {
        await db.deleteFrom(table).where("target_id", "=", recordId).execute();
      }
    }
  }
}

/**
 * Adds each many to many field to the rows as a list of ids, in link order.
 * With a reader, ids of records that reader may not read are left out.
 */
export async function attachLinks(
  db: BakorinDb,
  ast: SchemaAST,
  entity: EntityAST,
  rows: Record<string, unknown>[],
  reader?: { actor: Actor | null },
): Promise<void> {
  const fields = manyFields(entity);
  if (fields.length === 0 || rows.length === 0) {
    return;
  }
  const ids = rows.map((row) => String(row.id));
  for (const field of fields) {
    const table = joinTableName(entity.name, field.name);
    const links: Array<{ source_id: string; target_id: string }> = [];
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = (await db
        .selectFrom(table)
        .select(["source_id", "target_id"])
        .where("source_id", "in", ids.slice(i, i + 500))
        .orderBy("source_id")
        .orderBy("position")
        .execute()) as Array<{ source_id: string; target_id: string }>;
      links.push(...chunk);
    }
    let allowed: Set<string> | null = null;
    if (reader) {
      allowed = await readableIds(db, ast, field.relation!.to, [...new Set(links.map((link) => link.target_id))], reader.actor);
    }
    const bySource = new Map<string, string[]>();
    for (const link of links) {
      if (allowed && !allowed.has(link.target_id)) continue;
      const list = bySource.get(link.source_id);
      if (list) list.push(link.target_id);
      else bySource.set(link.source_id, [link.target_id]);
    }
    for (const row of rows) {
      row[field.name] = bySource.get(String(row.id)) ?? [];
    }
  }
}

/** The subset of ids in an entity that the reader may read (all of them for admins and public reads). */
export async function readableIds(
  db: BakorinDb,
  ast: SchemaAST,
  entityName: string,
  ids: string[],
  actor: Actor | null,
): Promise<Set<string>> {
  const target = ast.entityMap[entityName];
  if (!target || ids.length === 0) {
    return new Set();
  }
  const decision = decideAccess(ast, target, "read", actor);
  if (!decision.allow) {
    return new Set();
  }
  if (decision.bypass || decision.ownerFields.length === 0) {
    return new Set(ids);
  }
  const out = new Set<string>();
  for (let i = 0; i < ids.length; i += 500) {
    let qb = db.selectFrom(target.name).select("id").where("id", "in", ids.slice(i, i + 500));
    qb = applyAccess(qb as never, decision) as typeof qb;
    for (const row of (await qb.execute()) as Array<{ id: string }>) out.add(String(row.id));
  }
  return out;
}
