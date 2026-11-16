import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { Database } from "bun:sqlite";
import { deserializeAst, type SchemaAST } from "@bakorin/core";

export interface ManifestFile {
  sha256: string;
  size: number;
}

/** Fields added to manifest.json when a backup is sealed. Older backups lack them. */
export interface ManifestIntegrity {
  files?: Record<string, ManifestFile>;
  counts?: Record<string, number>;
}

export interface VerifyResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  checkedFiles: number;
  counts: Record<string, number>;
  manifest: Record<string, unknown>;
}

const MANIFEST = "manifest.json";

export async function sha256File(path: string): Promise<string> {
  const hasher = new Bun.CryptoHasher("sha256");
  const reader = Bun.file(path).stream().getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    hasher.update(value);
  }
  return hasher.digest("hex");
}

export async function walkRelative(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }> = [];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(path);
      } else if (entry.isFile()) {
        out.push(relative(root, path).split("\\").join("/"));
      }
    }
  }
  await walk(root);
  return out.sort();
}

async function ndjsonCounts(dataDir: string): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  let names: string[] = [];
  try {
    names = await readdir(dataDir);
  } catch {
    return counts;
  }
  for (const name of names.sort()) {
    if (!name.endsWith(".ndjson")) {
      continue;
    }
    const text = await readFile(join(dataDir, name), "utf8");
    counts[name.slice(0, -".ndjson".length)] = text.split("\n").filter((line) => line.trim()).length;
  }
  return counts;
}

function sqliteCounts(path: string): Record<string, number> {
  const counts: Record<string, number> = {};
  const db = new Database(path, { readonly: true });
  try {
    const tables = db
      .query("select name from sqlite_master where type = 'table' and name not like 'sqlite_%' order by name")
      .all() as Array<{ name: string }>;
    for (const { name } of tables) {
      const row = db.query(`select count(*) as n from "${name.replaceAll('"', '""')}"`).get() as { n: number };
      counts[name] = Number(row.n);
    }
  } finally {
    db.close();
  }
  return counts;
}

/** Row counts per table: from the portable NDJSON, or the SQLite snapshot when there is no portable copy. */
export async function backupCounts(dir: string): Promise<Record<string, number>> {
  for (const dataDir of [join(dir, "data"), join(dir, "portable", "data")]) {
    if (await exists(dataDir)) {
      return ndjsonCounts(dataDir);
    }
  }
  if (await Bun.file(join(dir, "app.db")).exists()) {
    return sqliteCounts(join(dir, "app.db"));
  }
  return {};
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Adds a sha256 and size for every file to manifest.json, plus row counts.
 * Run after everything else in the backup folder is written.
 */
export async function sealBackup(dir: string): Promise<void> {
  const manifestPath = join(dir, MANIFEST);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
  const files: Record<string, ManifestFile> = {};
  for (const rel of await walkRelative(dir)) {
    if (rel === MANIFEST) {
      continue;
    }
    const path = join(dir, rel);
    files[rel] = { sha256: await sha256File(path), size: (await stat(path)).size };
  }
  manifest.files = files;
  manifest.counts = await backupCounts(dir);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

/** Checks a backup folder against its manifest without changing anything. */
export async function verifyBackup(dir: string): Promise<VerifyResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  let manifest: Record<string, unknown> = {};
  try {
    manifest = JSON.parse(await readFile(join(dir, MANIFEST), "utf8")) as Record<string, unknown>;
  } catch {
    return {
      ok: false,
      errors: ["manifest.json is missing or not valid JSON, so this is not a Bakorin backup folder"],
      warnings,
      checkedFiles: 0,
      counts: {},
      manifest,
    };
  }
  if (manifest.format !== 1) {
    errors.push(`unsupported backup format ${String(manifest.format)}`);
  }
  if (manifest.kind !== "sqlite-snapshot" && manifest.kind !== "portable") {
    errors.push(`unknown backup kind ${String(manifest.kind)}`);
  }
  const listed = (manifest.files ?? null) as Record<string, ManifestFile> | null;
  let checkedFiles = 0;
  if (!listed) {
    warnings.push("this backup was made before checksums were added, so file contents cannot be verified");
  } else {
    for (const [rel, expected] of Object.entries(listed)) {
      const path = join(dir, rel);
      if (!(await Bun.file(path).exists())) {
        errors.push(`missing file: ${rel}`);
        continue;
      }
      const size = (await stat(path)).size;
      if (size !== expected.size) {
        errors.push(`size mismatch: ${rel} (expected ${expected.size}, found ${size})`);
        continue;
      }
      if ((await sha256File(path)) !== expected.sha256) {
        errors.push(`checksum mismatch: ${rel}`);
        continue;
      }
      checkedFiles += 1;
    }
    for (const rel of await walkRelative(dir)) {
      if (rel !== MANIFEST && !(rel in listed)) {
        warnings.push(`extra file not in manifest: ${rel}`);
      }
    }
  }
  if (manifest.kind === "sqlite-snapshot" && !(await Bun.file(join(dir, "app.db")).exists())) {
    errors.push("sqlite snapshot is missing app.db");
  }
  let counts: Record<string, number> = {};
  if (errors.length === 0) {
    try {
      counts = await backupCounts(dir);
    } catch (error) {
      errors.push(`could not read the backup data: ${error instanceof Error ? error.message : String(error)}`);
    }
    const recorded = manifest.counts as Record<string, number> | undefined;
    if (recorded) {
      for (const [table, count] of Object.entries(recorded)) {
        if (counts[table] !== undefined && counts[table] !== count) {
          errors.push(`row count mismatch for ${table}: manifest ${count}, data ${counts[table]}`);
        }
      }
    }
  }
  return { ok: errors.length === 0, errors, warnings, checkedFiles, counts, manifest };
}

/** The schema stored with a backup, when it has one. */
export async function backupSchema(dir: string): Promise<SchemaAST | null> {
  for (const path of [join(dir, "schema.ast.json"), join(dir, "portable", "schema.ast.json")]) {
    if (await Bun.file(path).exists()) {
      return deserializeAst(await readFile(path, "utf8"));
    }
  }
  if (await Bun.file(join(dir, "app.db")).exists()) {
    const db = new Database(join(dir, "app.db"), { readonly: true });
    try {
      const row = db.query("select value from _bakorin_meta where key = 'schema_ast'").get() as { value: string } | null;
      return row ? deserializeAst(row.value) : null;
    } catch {
      return null;
    } finally {
      db.close();
    }
  }
  return null;
}
