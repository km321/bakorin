import { join } from "node:path";
import { rm } from "node:fs/promises";
import type { SchemaAST } from "@bakorin/core";
import type { BakorinDb } from "../db/dialects.ts";
import { createS3FileStore, parseS3Url, pruneS3Backups, type FileStore } from "../files/store.ts";
import { resolveRuntimePath } from "../paths.ts";
import { exportPortable, pruneBackups } from "./archive.ts";
import { backupSqlite } from "./sqlite.ts";

function stamp(): string {
  return new Date().toISOString().replaceAll(":", "-");
}

function s3StoreFromAst(ast: SchemaAST, bucket: string): FileStore {
  return createS3FileStore({
    bucket,
    accessKey: ast.runtime.files.accessKey ?? process.env.S3_ACCESS_KEY ?? process.env.AWS_ACCESS_KEY_ID ?? "",
    secretKey: ast.runtime.files.secretKey ?? process.env.S3_SECRET_KEY ?? process.env.AWS_SECRET_ACCESS_KEY ?? "",
    endpoint:
      ast.runtime.files.endpoint ??
      process.env.S3_ENDPOINT ??
      process.env.AWS_ENDPOINT_URL ??
      process.env.AWS_ENDPOINT,
    region:
      ast.runtime.files.region ?? process.env.S3_REGION ?? process.env.AWS_DEFAULT_REGION ?? process.env.AWS_REGION ?? "auto",
    virtualHostedStyle: ast.runtime.files.virtualHostedStyle,
  });
}

export async function runBackup(options: {
  ast: SchemaAST;
  db: BakorinDb;
  files: FileStore;
  projectDir: string;
  destination?: string;
}): Promise<string> {
  const destRoot = options.destination ?? options.ast.runtime.backups.destination;
  const remote = destRoot.startsWith("s3://");
  const stampName = stamp();
  const localRoot = remote ? destRoot : resolveRuntimePath(options.projectDir, destRoot);
  const dest = remote ? join(options.projectDir, ".tmp-backup", stampName) : join(localRoot, stampName);
  if (options.ast.runtime.dialect === "sqlite") {
    const dbPath = resolveRuntimePath(options.projectDir, options.ast.runtime.sqlitePath);
    await backupSqlite({
      dbPath,
      projectDir: options.projectDir,
      dest,
      ast: options.ast,
      uploadsPath: resolveRuntimePath(options.projectDir, options.ast.runtime.files.path),
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
  if (remote) {
    const { bucket, prefix } = parseS3Url(destRoot);
    const store = s3StoreFromAst(options.ast, bucket);
    const keyPrefix = prefix ? `${prefix}/${stampName}` : stampName;
    await store.importAllFrom(dest, keyPrefix);
    await pruneS3Backups(store, prefix, options.ast.runtime.backups.retain);
    await rm(join(options.projectDir, ".tmp-backup"), { recursive: true, force: true });
    return `s3://${bucket}/${keyPrefix}`;
  }
  await pruneBackups(localRoot, options.ast.runtime.backups.retain);
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
