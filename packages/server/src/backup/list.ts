import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { SchemaAST } from "@bakorin/core";
import { parseS3Url } from "../files/store.ts";
import { resolveRuntimePath } from "../paths.ts";
import { s3StoreFromAst } from "./schedule.ts";

export interface BackupInfo {
  id: string;
  createdAt: string;
  size: number;
  location: string;
  restoreCommand: string;
}

function stampToIso(stamp: string): string {
  const match = /^(\d{4}-\d{2}-\d{2}T)(\d{2})-(\d{2})-(\d{2}(?:\.\d+)?)Z$/.exec(stamp);
  if (!match) {
    return stamp;
  }
  return `${match[1]}${match[2]}:${match[3]}:${match[4]}Z`;
}

function restoreCommand(location: string): string {
  if (location.startsWith("s3://")) {
    const id = location.replace(/\/+$/, "").split("/").pop() ?? "backup";
    return `bakorin restore ./${id}.tar.gz  # download it from the Backups screen first`;
  }
  return `bakorin restore ${location}`;
}

function isStamp(name: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T/.test(name);
}

async function directorySize(dir: string): Promise<number> {
  let total = 0;
  let entries: Array<{ name: string; isDirectory(): boolean }> = [];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      total += await directorySize(path);
    } else {
      total += (await stat(path)).size;
    }
  }
  return total;
}

async function listLocalBackups(root: string): Promise<BackupInfo[]> {
  let entries: Array<{ name: string; isDirectory(): boolean }> = [];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const backups: BackupInfo[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !isStamp(entry.name)) {
      continue;
    }
    const location = join(root, entry.name);
    backups.push({
      id: entry.name,
      createdAt: stampToIso(entry.name),
      size: await directorySize(location),
      location,
      restoreCommand: restoreCommand(location),
    });
  }
  return backups.sort((a, b) => b.id.localeCompare(a.id));
}

async function listS3Backups(ast: SchemaAST, destination: string): Promise<BackupInfo[]> {
  const { bucket, prefix } = parseS3Url(destination);
  const store = s3StoreFromAst(ast, bucket);
  const listPrefix = prefix ? `${prefix}/` : "";
  const objects = await store.listDetailed(listPrefix);
  const grouped = new Map<string, number>();
  for (const object of objects) {
    const rest = listPrefix && object.key.startsWith(listPrefix) ? object.key.slice(listPrefix.length) : object.key;
    const stamp = rest.split("/")[0];
    if (!stamp || !isStamp(stamp)) {
      continue;
    }
    grouped.set(stamp, (grouped.get(stamp) ?? 0) + object.size);
  }
  return [...grouped.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([id, size]) => {
      const location = prefix ? `s3://${bucket}/${prefix}/${id}` : `s3://${bucket}/${id}`;
      return {
        id,
        createdAt: stampToIso(id),
        size,
        location,
        restoreCommand: restoreCommand(location),
      };
    });
}

export async function listBackups(ast: SchemaAST, projectDir: string): Promise<BackupInfo[]> {
  const destination = ast.runtime.backups.destination;
  if (destination.startsWith("s3://")) {
    return listS3Backups(ast, destination);
  }
  return listLocalBackups(resolveRuntimePath(projectDir, destination));
}
