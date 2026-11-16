import { mkdir, cp, rename, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { Database } from "bun:sqlite";
import type { SchemaAST } from "@bakorin/core";
import { copyProjectFiles, writeManifest } from "./archive.ts";

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export async function backupSqlite(options: {
  dbPath: string;
  projectDir: string;
  dest: string;
  ast: SchemaAST;
  uploadsPath: string;
  reason?: string;
}): Promise<string> {
  const dest = resolve(options.dest);
  await mkdir(dest, { recursive: true });
  const snapshot = join(dest, "app.db");
  await mkdir(dirname(snapshot), { recursive: true });
  const db = new Database(options.dbPath);
  try {
    db.exec("pragma wal_checkpoint(FULL)");
    db.exec(`vacuum into ${sqlString(snapshot)}`);
  } finally {
    db.close();
  }
  await copyProjectFiles(options.projectDir, dest);
  try {
    await cp(options.uploadsPath, join(dest, "uploads"), { recursive: true });
  } catch {
    // no uploads yet
  }
  await writeManifest(dest, {
    format: 1,
    createdAt: new Date().toISOString(),
    appName: options.ast.appName,
    dialect: "sqlite",
    kind: "sqlite-snapshot",
    ...(options.reason ? { reason: options.reason } : {}),
  });
  return dest;
}

export async function restoreSqliteSnapshot(options: { src: string; dbPath: string; uploadsPath: string }): Promise<void> {
  const srcDb = join(resolve(options.src), "app.db");
  if (!(await Bun.file(srcDb).exists())) {
    throw new Error("sqlite snapshot is missing app.db");
  }
  await mkdir(dirname(options.dbPath), { recursive: true });
  // A leftover write-ahead log from the old database would be replayed on top of
  // the restored file, so remove it before copying.
  await rm(`${options.dbPath}-wal`, { force: true });
  await rm(`${options.dbPath}-shm`, { force: true });
  // Copy next to the target, then rename: the database gets a fresh file instead of
  // being overwritten in place under any handle that is still open.
  const staging = `${options.dbPath}.restore-${process.pid}`;
  await cp(srcDb, staging);
  await rename(staging, options.dbPath);
  const uploads = join(options.src, "uploads");
  try {
    await mkdir(options.uploadsPath, { recursive: true });
    await cp(uploads, options.uploadsPath, { recursive: true });
  } catch {
    // none
  }
}
