import { join } from "node:path";
import type { SchemaAST } from "@bakorin/core";
import type { BakorinDb } from "../db/dialects.ts";
import type { FileStore } from "../files/store.ts";
import { exportPortable, pruneBackups } from "./archive.ts";
import { backupSqlite } from "./sqlite.ts";
import { createS3FileStore } from "../files/store.ts";

function stamp(): string {
  return new Date().toISOString().replaceAll(":", "-");
}

export async function runBackup(options: {
  ast: SchemaAST;
  db: BakorinDb;
  files: FileStore;
  projectDir: string;
  destination?: string;
}): Promise<string> {
  const destRoot = options.destination ?? options.ast.runtime.backups.destination;
  const dest = destRoot.startsWith("s3://") ? join(options.projectDir, ".tmp-backup", stamp()) : join(destRoot, stamp());
  if (options.ast.runtime.dialect === "sqlite") {
    const dbPath = join(options.projectDir, options.ast.runtime.sqlitePath);
    await backupSqlite({
      dbPath,
      projectDir: options.projectDir,
      dest,
      ast: options.ast,
      uploadsPath: join(options.projectDir, options.ast.runtime.files.path),
    });
    await exportPortable({
      dest: join(dest, "portable"),
      projectDir: options.projectDir,
      ast: options.ast,
      db: options.db,
      files: options.files,
    });
  } else {
    await exportPortable({
      dest,
      projectDir: options.projectDir,
      ast: options.ast,
      db: options.db,
      files: options.files,
    });
  }
  if (destRoot.startsWith("s3://")) {
    const url = new URL(destRoot);
    const store = createS3FileStore({
      bucket: url.host,
      accessKey: options.ast.runtime.files.accessKey ?? process.env.S3_ACCESS_KEY ?? "",
      secretKey: options.ast.runtime.files.secretKey ?? process.env.S3_SECRET_KEY ?? "",
      endpoint: options.ast.runtime.files.endpoint,
      region: options.ast.runtime.files.region,
    });
    await store.importAllFrom(dest);
  }
  if (!destRoot.startsWith("s3://")) {
    await pruneBackups(destRoot, options.ast.runtime.backups.retain);
  }
  return dest;
}

export function startBackupScheduler(
  options: {
    ast: SchemaAST;
    db: BakorinDb;
    files: FileStore;
    projectDir: string;
  },
): () => void {
  const hours = options.ast.runtime.backups.intervalHours;
  if (!hours) {
    return () => undefined;
  }
  const timer = setInterval(
    () => {
      void runBackup(options).catch((error: unknown) => {
        console.error("[bakorin] scheduled backup failed", error);
      });
    },
    hours * 60 * 60 * 1000,
  );
  return () => clearInterval(timer);
}
