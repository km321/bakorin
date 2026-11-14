import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { sql } from "kysely";
import { serializeAst, type SchemaAST } from "@bakorin/core";
import type { BakorinDb } from "../db/dialects.ts";
import { FILES_TABLE, META_TABLE, REFRESH_TABLE } from "../db/system.ts";
import type { FileStore } from "../files/store.ts";
import { decodeRow } from "../crud/query.ts";
import { encodeValue } from "../db/types.ts";

export const BACKUP_FORMAT = 1 as const;

export interface BackupManifest {
  format: typeof BACKUP_FORMAT;
  createdAt: string;
  appName: string;
  dialect: SchemaAST["runtime"]["dialect"];
  kind: "sqlite-snapshot" | "portable";
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
}

export async function exportPortable(options: {
  dest: string;
  projectDir: string;
  ast: SchemaAST;
  db: BakorinDb;
  files: FileStore;
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
  const filesMeta = await options.db.selectFrom(FILES_TABLE).selectAll().execute();
  await writeFile(
    join(dest, "data", `${FILES_TABLE}.ndjson`),
    filesMeta.length ? `${filesMeta.map((row) => JSON.stringify(row)).join("\n")}\n` : "",
  );
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
  });
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
  for (const name of [...options.ast.order].reverse()) {
    const entity = options.ast.entityMap[name];
    if (entity) {
      await options.db.deleteFrom(entity.name).execute();
    }
  }
  for (const name of options.ast.order) {
    const entity = options.ast.entityMap[name]!;
    const rows = await readNdjson(join(src, "data", `${entity.name}.ndjson`));
    for (const row of rows) {
      const insert: Record<string, unknown> = {};
      for (const field of entity.fields) {
        if (field.name in row) {
          insert[field.name] = encodeValue(options.ast.runtime.dialect, field, row[field.name]);
        }
      }
      if (Object.keys(insert).length > 0) {
        await options.db.insertInto(entity.name).values(insert).execute();
      }
    }
  }
  await sql.raw(`delete from ${FILES_TABLE}`).execute(options.db);
  for (const row of await readNdjson(join(src, "data", `${FILES_TABLE}.ndjson`))) {
    await options.db.insertInto(FILES_TABLE).values(row).execute();
  }
  const filesDir = join(src, "files");
  if (await Bun.file(filesDir).exists().catch(() => false)) {
    await options.files.importAllFrom(filesDir);
  } else {
    try {
      const entries = await readdir(filesDir);
      if (entries.length >= 0) {
        await options.files.importAllFrom(filesDir);
      }
    } catch {
      // no files
    }
  }
  void META_TABLE;
  void REFRESH_TABLE;
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
