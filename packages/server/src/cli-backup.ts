/** bakorin backup, export, restore, and import. */

import { mkdir, rm, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { diffSchemas, formatPlan } from "@bakorin/core";
import { runBackup } from "./backup/schedule.ts";
import { exportPortable, importPortable, readManifest, restoreProjectAssets } from "./backup/archive.ts";
import { restoreSqliteSnapshot } from "./backup/sqlite.ts";
import { countPendingDeliveries, discardPendingDeliveries } from "./backup/pending.ts";
import { backupSchema, verifyBackup, type VerifyResult } from "./backup/integrity.ts";
import { readTar } from "./backup/tar.ts";
import { resolveRuntimePath } from "./paths.ts";
import { hasFlag, projectDir } from "./cli-args.ts";
import { openForPlan } from "./cli-schema.ts";
import { loadOrExit } from "./cli-serve.ts";

export async function cmdBackup(): Promise<void> {
  const dir = projectDir();
  const runtime = await loadOrExit(dir);
  const dest = process.argv[3] && !process.argv[3].startsWith("-") ? resolve(process.argv[3]) : undefined;
  const path = await runBackup({
    ast: runtime.ast,
    db: runtime.db,
    files: runtime.context.files,
    projectDir: dir,
    destination: dest,
  });
  console.log(`backup written to ${path}`);
  await runtime.close();
}

export async function cmdExport(): Promise<void> {
  const dir = projectDir();
  const runtime = await loadOrExit(dir);
  const dest = resolve(process.argv[3] && !process.argv[3].startsWith("-") ? process.argv[3] : join(dir, "data/export"));
  const path = await exportPortable({
    dest,
    projectDir: dir,
    ast: runtime.ast,
    db: runtime.db,
    files: runtime.context.files,
  });
  console.log(`portable export written to ${path}`);
  await runtime.close();
}

function printVerify(result: VerifyResult): void {
  const manifest = result.manifest;
  console.log(`Backup: ${String(manifest.appName ?? "?")}, ${String(manifest.kind ?? "?")} from ${String(manifest.dialect ?? "?")}`);
  console.log(`Created: ${String(manifest.createdAt ?? "?")}${manifest.reason ? ` (${String(manifest.reason)})` : ""}`);
  if (result.checkedFiles > 0) {
    console.log(`Checksums: ${result.checkedFiles} files match`);
  }
  for (const warning of result.warnings) {
    console.log(`Warning: ${warning}`);
  }
  for (const error of result.errors) {
    console.error(`Error: ${error}`);
  }
  const counts = Object.entries(result.counts);
  if (counts.length > 0) {
    console.log("Rows:");
    for (const [table, count] of counts) {
      console.log(`  ${table}: ${count}`);
    }
  }
}

async function findManifestRoot(dir: string): Promise<string> {
  if (await Bun.file(join(dir, "manifest.json")).exists()) {
    return dir;
  }
  const { readdir } = await import("node:fs/promises");
  const entries = await readdir(dir, { withFileTypes: true });
  const dirs = entries.filter((entry) => entry.isDirectory());
  if (dirs.length === 1 && (await Bun.file(join(dir, dirs[0]!.name, "manifest.json")).exists())) {
    return join(dir, dirs[0]!.name);
  }
  return dir;
}

/** Accepts a backup folder or a downloaded .tar.gz; returns the folder to restore from. */
async function openBackupSource(dir: string, src: string): Promise<{ source: string; cleanup: () => Promise<void> }> {
  const path = resolve(src);
  let info;
  try {
    info = await stat(path);
  } catch {
    console.error(`backup not found: ${path}`);
    process.exit(1);
  }
  if (info.isDirectory()) {
    return { source: path, cleanup: async () => {} };
  }
  const tmp = join(dir, ".tmp-restore", new Date().toISOString().replaceAll(":", "-"));
  const files = readTar(new Uint8Array(await Bun.file(path).arrayBuffer()));
  for (const file of files) {
    const target = resolve(tmp, file.path);
    if (!target.startsWith(`${resolve(tmp)}/`)) {
      throw new Error(`unsafe path in archive: ${file.path}`);
    }
    await mkdir(dirname(target), { recursive: true });
    await Bun.write(target, file.bytes);
  }
  return {
    source: await findManifestRoot(tmp),
    cleanup: async () => {
      await rm(join(dir, ".tmp-restore"), { recursive: true, force: true });
    },
  };
}

/**
 * Backups carry the mail and webhook queues. With --discard-pending they are
 * dropped (for staging copies of production); otherwise restore says how many
 * will send when the server starts.
 */
async function handlePendingDeliveries(db: Parameters<typeof countPendingDeliveries>[0]): Promise<void> {
  if (hasFlag("--discard-pending")) {
    const dropped = await discardPendingDeliveries(db);
    console.log(`discarded ${dropped.webhooks} pending webhook and ${dropped.mail} pending mail deliveries`);
    return;
  }
  const pending = await countPendingDeliveries(db);
  if (pending.webhooks + pending.mail > 0) {
    console.warn(
      `[bakorin] WARNING: ${pending.webhooks} webhook and ${pending.mail} mail deliveries from the backup are still pending and will be sent when the server starts. ` +
        "Restoring production into staging? Run this restore again with --discard-pending before you start the server.",
    );
  }
}

export async function cmdRestore(): Promise<void> {
  const dir = projectDir();
  const src = process.argv[3];
  if (!src || src.startsWith("-")) {
    console.error("usage: bakorin restore <backup-dir | backup.tar.gz> [--dry-run] [--no-backup] [--discard-pending]");
    process.exit(1);
  }
  const dryRun = hasFlag("--dry-run") || hasFlag("--verify");
  const { source, cleanup } = await openBackupSource(dir, src);
  try {
    const verified = await verifyBackup(source);
    printVerify(verified);
    if (!verified.ok) {
      console.error("Restore stopped: the backup failed verification. Nothing was changed.");
      process.exitCode = 1;
      return;
    }
    const manifest = await readManifest(source);
    if (dryRun) {
      const planned = await openForPlan(dir);
      try {
        const saved = await backupSchema(source);
        const targetDialect = planned.ast.runtime.dialect;
        const method =
          manifest.kind === "sqlite-snapshot" && targetDialect === "sqlite"
            ? "replace the SQLite database file and uploads with the snapshot"
            : "replace all records, file metadata, mail and webhook queues and audit log with the portable copy";
        console.log("");
        console.log(`Dry run: restore would ${method}, into ${targetDialect}.`);
        if (saved) {
          const plan = diffSchemas(saved, planned.ast);
          console.log("Compared with the current app.yaml:");
          console.log(formatPlan(plan).replace(/^/gm, "  "));
        }
        console.log("Nothing was changed.");
      } finally {
        await planned.opened.close();
      }
      return;
    }
    const assets = await restoreProjectAssets(source, dir);
    if (assets.length > 0) {
      console.log(`restored branding/: ${assets.join(", ")}`);
    }
    const runtime = await loadOrExit(dir, { workers: false });
    if (!hasFlag("--no-backup")) {
      const safety = await runBackup({
        ast: runtime.ast,
        db: runtime.db,
        files: runtime.context.files,
        projectDir: dir,
        reason: "pre-restore",
      });
      console.log(`current data backed up first to ${safety}`);
    }
    if (manifest.kind === "sqlite-snapshot" && runtime.ast.runtime.dialect === "sqlite") {
      await runtime.close();
      await restoreSqliteSnapshot({
        src: source,
        dbPath: resolveRuntimePath(dir, runtime.ast.runtime.sqlitePath),
        uploadsPath: resolveRuntimePath(dir, runtime.ast.runtime.files.path),
      });
      console.log("sqlite snapshot restored");
      const reopened = await loadOrExit(dir, { workers: false });
      try {
        await handlePendingDeliveries(reopened.db);
      } finally {
        await reopened.close();
      }
      return;
    }
    const portable = manifest.kind === "sqlite-snapshot" ? join(source, "portable") : source;
    await importPortable({ src: portable, ast: runtime.ast, db: runtime.db, files: runtime.context.files });
    console.log("portable backup restored");
    await handlePendingDeliveries(runtime.db);
    await runtime.close();
  } finally {
    await cleanup();
  }
}

export async function cmdImport(): Promise<void> {
  const dir = projectDir();
  const src = process.argv[3];
  if (!src) {
    console.error("usage: bakorin import <export-dir>");
    process.exit(1);
  }
  const runtime = await loadOrExit(dir);
  await importPortable({ src: resolve(src), ast: runtime.ast, db: runtime.db, files: runtime.context.files });
  console.log("portable archive imported");
  await runtime.close();
}
