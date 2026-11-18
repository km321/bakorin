import { sql } from "kysely";
import { quoteChecked, type DialectName, type EntityAST, type SchemaAST } from "@bakorin/core";
import type { BakorinDb } from "../db/dialects.ts";
import { textCast } from "../db/ddl.ts";
import { DEPRECATED_TABLE, FILES_TABLE } from "../db/system.ts";
import type { Actor } from "../context.ts";
import { signFileUrl } from "./sign.ts";

/**
 * Where uploads are referenced. A file belongs to a record when one of the
 * record's file fields holds its id. Fields removed from app.yaml keep their
 * column (a soft drop), so their values still count: re-adding the field brings
 * the data back, and its files must still be there.
 */
export interface FileSource {
  entity: string;
  field: string;
  /** The entity's display field, for labels. */
  display?: string;
  /** True for a field that was removed from app.yaml but still has data. */
  removed: boolean;
}

export interface FileUse {
  entity: string;
  field: string;
  id: string;
  label: string;
  removed: boolean;
}

export interface FileInfo {
  id: string;
  filename: string;
  contentType: string;
  size: number;
  createdAt: string;
  createdBy: string | null;
}

export interface SignedFile extends FileInfo {
  url: string;
  downloadUrl: string;
  expiresAt: number;
}

export function fileFields(entity: EntityAST): string[] {
  return entity.fields.filter((field) => field.type === "file").map((field) => field.name);
}

async function columnExists(db: BakorinDb, table: string, column: string): Promise<boolean> {
  try {
    await sql`select ${sql.ref(column)} from ${sql.table(table)} where 1 = 0`.execute(db);
    return true;
  } catch {
    return false;
  }
}

/** Every column that can hold a file id: live file fields plus removed fields that still exist. */
export async function fileSources(db: BakorinDb, ast: SchemaAST): Promise<FileSource[]> {
  const sources: FileSource[] = [];
  const live = new Set<string>();
  for (const entity of ast.entities) {
    for (const field of fileFields(entity)) {
      const shown = entity.fieldMap[entity.display];
      const display = shown && !shown.secret && !shown.relation?.many ? entity.display : undefined;
      sources.push({ entity: entity.name, field, display, removed: false });
      live.add(`${entity.name}.${field}`);
    }
  }
  const dropped = await db
    .selectFrom(DEPRECATED_TABLE)
    .select(["entity", "field"])
    .where("kind", "=", "field")
    .execute()
    .catch(() => [] as Array<{ entity: string; field: string | null }>);
  for (const row of dropped) {
    const entity = String(row.entity);
    const field = row.field ? String(row.field) : "";
    if (!field || live.has(`${entity}.${field}`) || !ast.entityMap[entity]) {
      continue;
    }
    if (await columnExists(db, entity, field)) {
      const owner = ast.entityMap[entity]!;
      const shown = owner.fieldMap[owner.display];
      const display = shown && !shown.secret && !shown.relation?.many ? owner.display : undefined;
      sources.push({ entity, field, display, removed: true });
    }
  }
  return sources;
}

function textColumn(source: FileSource, dialect: DialectName) {
  // Removed fields can be any type: compare as text so Postgres accepts it.
  return source.removed
    ? sql`cast(${sql.raw(quoteChecked(source.entity))}.${sql.raw(quoteChecked(source.field))} as ${textCast(dialect)})`
    : sql`${sql.raw(quoteChecked(source.entity))}.${sql.raw(quoteChecked(source.field))}`;
}

/** SQL that is true when the _bakorin_files row is not referenced by any source. */
export function orphanCondition(sources: FileSource[], dialect: DialectName) {
  if (sources.length === 0) {
    return sql<boolean>`1 = 1`;
  }
  const parts = sources.map(
    (source) =>
      sql`not exists (select 1 from ${sql.raw(quoteChecked(source.entity))} where ${textColumn(source, dialect)} = ${sql.raw(FILES_TABLE)}.id)`,
  );
  return sql<boolean>`(${sql.join(parts, sql` and `)})`;
}

/** The records that use each of the given files. */
export async function fileUsage(
  db: BakorinDb,
  ast: SchemaAST,
  sources: FileSource[],
  ids: string[],
): Promise<Map<string, FileUse[]>> {
  const out = new Map<string, FileUse[]>();
  if (ids.length === 0) {
    return out;
  }
  for (const source of sources) {
    const display = source.display && source.display !== "id" ? source.display : undefined;
    const label = display ? sql`, ${sql.raw(quoteChecked(source.entity))}.${sql.raw(quoteChecked(display))} as label` : sql``;
    const result = await sql<{ id: string; ref: string; label?: unknown }>`select ${sql.raw(quoteChecked(source.entity))}.id as id, ${textColumn(source, ast.runtime.dialect)} as ref${label} from ${sql.raw(quoteChecked(source.entity))} where ${textColumn(source, ast.runtime.dialect)} in (${sql.join(ids)}) limit 1000`.execute(db);
    for (const row of result.rows) {
      const list = out.get(String(row.ref)) ?? [];
      list.push({
        entity: source.entity,
        field: source.field,
        id: String(row.id),
        label: row.label === undefined || row.label === null || row.label === "" ? String(row.id) : String(row.label),
        removed: source.removed,
      });
      out.set(String(row.ref), list);
    }
  }
  return out;
}

export function fileInfo(row: Record<string, unknown>): FileInfo {
  return {
    id: String(row.id),
    filename: String(row.filename),
    contentType: String(row.content_type),
    size: Number(row.size),
    createdAt: String(row.created_at),
    createdBy: row.created_by ? String(row.created_by) : null,
  };
}

/** A short lived link for one file. downloadUrl always downloads; url shows images, PDF and text inline. */
export function signedFile(ast: SchemaAST, info: FileInfo): SignedFile {
  const expiresAt = Math.floor(Date.now() / 1000) + ast.runtime.files.signedUrlTtlSeconds;
  const url = signFileUrl(ast.runtime.jwtSecret, info.id, expiresAt);
  return { ...info, url, downloadUrl: `${url}&download=1`, expiresAt };
}

/**
 * Checks file field values on a write: the file must exist, and a non admin may
 * only attach a file they uploaded. Keeping the value a record already has is
 * always allowed, so editing other fields never trips on a file someone else added.
 */
export async function assertFileTargets(
  db: BakorinDb,
  ast: SchemaAST,
  entity: EntityAST,
  body: Record<string, unknown>,
  actor: Actor | null,
  before?: Record<string, unknown>,
): Promise<string | null> {
  const admin = Boolean(actor && actor.role === ast.auth.adminRole);
  for (const name of fileFields(entity)) {
    const value = body[name];
    if (value === undefined || value === null || value === "") {
      continue;
    }
    if (before && before[name] === value) {
      continue;
    }
    const row = await db.selectFrom(FILES_TABLE).select(["id", "created_by"]).where("id", "=", String(value)).executeTakeFirst();
    if (!row) {
      return `${name} must be the id of an uploaded file`;
    }
    if (!admin && row.created_by && row.created_by !== actor?.id) {
      return `${name} must be a file you uploaded`;
    }
  }
  return null;
}
