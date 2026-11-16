import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { sql } from "kysely";
import { BRANDING_DIR, serializeAst, type SchemaAST } from "@bakorin/core";
import type { BakorinDb } from "../db/dialects.ts";
import {
  AUDIT_TABLE,
  DEPRECATED_TABLE,
  FILES_TABLE,
  MAIL_OUTBOX_TABLE,
  META_TABLE,
  WEBHOOK_OUTBOX_TABLE,
} from "../db/system.ts";
import type { FileStore } from "../files/store.ts";
import { decodeRow } from "../crud/query.ts";
import { encodeValue } from "../db/types.ts";
import { sealBackup } from "./integrity.ts";

/**
 * System tables carried in a portable export and restored by import. Sessions,
 * one-time auth tokens, rate limits, lockouts and leases are left out on purpose:
 * they are short-lived and restoring them would revive old sessions.
 */
export const PORTABLE_SYSTEM_TABLES = [FILES_TABLE, MAIL_OUTBOX_TABLE, WEBHOOK_OUTBOX_TABLE, AUDIT_TABLE, DEPRECATED_TABLE] as const;

export const BACKUP_FORMAT = 1 as const;

export interface BackupManifest {
  format: typeof BACKUP_FORMAT;
  createdAt: string;
  appName: string;
  dialect: SchemaAST["runtime"]["dialect"];
  kind: "sqlite-snapshot" | "portable";
  /** Why the backup was taken: "manual", "scheduled", "pre-migration", "pre-restore". */
  reason?: string;
  /** sha256 and size per file, added when the backup is sealed. */
  files?: Record<string, { sha256: string; size: number }>;
  /** Row counts per table at backup time. */
  counts?: Record<string, number>;
}

export async function writeManifest(dir: string, manifest: BackupManifest): Promise<void> {
  await writeFile(join(dir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

export async function readManifest(dir: string): Promise<BackupManifest> {
  return JSON.parse(await readFile(join(dir, "manifest.json"), "utf8")) as BackupManifest;
}

export async function copyProjectFiles(projectDir: string, dest: string): Promise<void> {
  await mkdir(dest, { recursive: true });
  for (const name of ["app.yaml", "hooks.ts", ".env.example"]) {
    const from = join(projectDir, name);
    if (await Bun.file(from).exists()) {
      await cp(from, join(dest, name));
    }
  }
  const branding = join(projectDir, BRANDING_DIR);
  if (await isDir(branding)) {
    await cp(branding, join(dest, BRANDING_DIR), { recursive: true });
  }
}

async function isDir(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Puts the backup's branding/ folder (logo, favicon) back into the project so
 * the restored project looks the same. Files with the same name are replaced.
 * Returns the restored file names.
 */
export async function restoreProjectAssets(src: string, projectDir: string): Promise<string[]> {
  const from = join(resolve(src), BRANDING_DIR);
  if (!(await isDir(from))) {
    return [];
  }
  const names = (await readdir(from)).filter((name) => !name.startsWith("."));
  await mkdir(join(projectDir, BRANDING_DIR), { recursive: true });
  await cp(from, join(projectDir, BRANDING_DIR), { recursive: true });
  return names;
}

export async function exportPortable(options: {
  dest: string;
  projectDir: string;
  ast: SchemaAST;
  db: BakorinDb;
  files: FileStore;
  reason?: string;
}): Promise<string> {
  const dest = resolve(options.dest);
  await mkdir(join(dest, "data"), { recursive: true });
  await copyProjectFiles(options.projectDir, dest);
  await writeFile(join(dest, "schema.ast.json"), serializeAst(options.ast));
  for (const name of options.ast.order) {
    const entity = options.ast.entityMap[name]!;
    const rows = await options.db.selectFrom(entity.name).selectAll().execute();
    const lines = rows.map((row) => JSON.stringify(decodeRow(entity, row as Record<string, unknown>)));
    await writeFile(join(dest, "data", `${entity.name}.ndjson`), lines.length ? `${lines.join("\n")}\n` : "");
  }
  for (const table of PORTABLE_SYSTEM_TABLES) {
    const rows = await options.db.selectFrom(table).selectAll().execute();
    await writeFile(
      join(dest, "data", `${table}.ndjson`),
      rows.length ? `${rows.map((row) => JSON.stringify(row)).join("\n")}\n` : "",
    );
  }
  const astMeta = await options.db.selectFrom(META_TABLE).selectAll().execute();
  await writeFile(
    join(dest, "data", `${META_TABLE}.ndjson`),
    astMeta.length ? `${astMeta.map((row) => JSON.stringify(row)).join("\n")}\n` : "",
  );
  await options.files.copyAllTo(join(dest, "files"));
  await writeManifest(dest, {
    format: BACKUP_FORMAT,
    createdAt: new Date().toISOString(),
    appName: options.ast.appName,
    dialect: options.ast.runtime.dialect,
    kind: "portable",
    ...(options.reason ? { reason: options.reason } : {}),
  });
  await sealBackup(dest);
  return dest;
}

async function readNdjson(path: string): Promise<Record<string, unknown>[]> {
  if (!(await Bun.file(path).exists())) {
    return [];
  }
  const text = await readFile(path, "utf8");
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

export async function importPortable(options: {
  src: string;
  ast: SchemaAST;
  db: BakorinDb;
  files: FileStore;
}): Promise<void> {
  const src = resolve(options.src);
  const manifest = await readManifest(src);
  if (manifest.format !== BACKUP_FORMAT) {
    throw new Error(`unsupported backup format ${String(manifest.format)}`);
  }
  const dialect = options.ast.runtime.dialect;
  const tables: Array<{ name: string; rows: Record<string, unknown>[] }> = [];
  for (const name of options.ast.order) {
    const entity = options.ast.entityMap[name]!;
    const rows = await readNdjson(join(src, "data", `${entity.name}.ndjson`));
    const encoded = rows
      .map((row) => {
        const insert: Record<string, unknown> = {};
        for (const field of entity.fields) {
          if (field.name in row) {
            insert[field.name] = encodeValue(dialect, field, row[field.name]);
          }
        }
        return insert;
      })
      .filter((row) => Object.keys(row).length > 0);
    tables.push({ name: entity.name, rows: encoded });
  }
  const systemTables: Array<{ name: string; rows: Record<string, unknown>[] }> = [];
  for (const table of PORTABLE_SYSTEM_TABLES) {
    const path = join(src, "data", `${table}.ndjson`);
    // Older exports have only the files table; leave other system tables alone then.
    if (table === FILES_TABLE || (await Bun.file(path).exists())) {
      systemTables.push({ name: table, rows: await readNdjson(path) });
    }
  }
  // One transaction: a failed import leaves the database as it was.
  await options.db.transaction().execute(async (trx) => {
    for (const { name } of [...tables].reverse()) {
      await trx.deleteFrom(name).execute();
    }
    for (const { name, rows } of tables) {
      for (const row of rows) {
        await trx.insertInto(name).values(row).execute();
      }
    }
    for (const { name, rows } of systemTables) {
      await sql.raw(`delete from ${name}`).execute(trx);
      for (const row of rows) {
        await trx.insertInto(name).values(row).execute();
      }
    }
  });
  const filesDir = join(src, "files");
  try {
    if ((await stat(filesDir)).isDirectory()) {
      await options.files.importAllFrom(filesDir);
    }
  } catch {
    // no files in this archive
  }
}

export async function pruneBackups(dir: string, retain: number): Promise<void> {
  let entries: string[] = [];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }
  const dirs = entries.filter((name) => /^\d{4}-/.test(name)).sort();
  const extra = dirs.length - retain;
  if (extra <= 0) {
    return;
  }
  for (const name of dirs.slice(0, extra)) {
    await rm(join(dir, name), { recursive: true, force: true });
  }
}
