import { createHmac, timingSafeEqual } from "node:crypto";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import type { SchemaAST } from "@bakorin/core";
import type { AppContext } from "../context.ts";
import { parseS3Url } from "../files/store.ts";
import { resolveRuntimePath } from "../paths.ts";
import { walkRelative } from "./integrity.ts";
import { s3StoreFromAst } from "./schedule.ts";
import type { TarEntry } from "./tar.ts";

/** Download links are single-purpose and short-lived. */
export const DOWNLOAD_TTL_MS = 60_000;

const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}(?:\.\d+)?Z$/;

export function isBackupId(id: string): boolean {
  return STAMP.test(id);
}

function sign(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(`backup-download.${payload}`).digest("base64url");
}

export function createDownloadToken(secret: string, backupId: string, actorId: string, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ id: backupId, sub: actorId, exp: now + DOWNLOAD_TTL_MS })).toString(
    "base64url",
  );
  return `${payload}.${sign(secret, payload)}`;
}

export function readDownloadToken(
  secrets: Array<string | undefined>,
  token: string,
  backupId: string,
  now = Date.now(),
): { sub: string } | null {
  const [payload, signature] = token.split(".");
  if (!payload || !signature) {
    return null;
  }
  const given = Buffer.from(signature);
  const valid = secrets.some((secret) => {
    if (!secret) {
      return false;
    }
    const expected = Buffer.from(sign(secret, payload));
    return expected.length === given.length && timingSafeEqual(expected, given);
  });
  if (!valid) {
    return null;
  }
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { id?: string; sub?: string; exp?: number };
    if (data.id !== backupId || typeof data.sub !== "string" || typeof data.exp !== "number" || data.exp < now) {
      return null;
    }
    return { sub: data.sub };
  } catch {
    return null;
  }
}

export async function actorIsAdmin(ctx: AppContext, actorId: string): Promise<boolean> {
  const auth = ctx.ast.auth;
  const row = await ctx.db
    .selectFrom(auth.entity)
    .select([auth.roleField])
    .where("id", "=", actorId)
    .executeTakeFirst();
  return Boolean(row) && String((row as Record<string, unknown>)[auth.roleField]) === auth.adminRole;
}

export function downloadFilename(appName: string, backupId: string): string {
  const slug = appName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "bakorin";
  return `${slug}-backup-${backupId.replaceAll(".", "-")}.tar.gz`;
}

/**
 * Files of one backup as tar entries, inside a folder named after the backup.
 * Works for a local destination and for an s3:// destination. Returns null
 * when the backup does not exist.
 */
export async function backupEntries(ast: SchemaAST, projectDir: string, backupId: string): Promise<TarEntry[] | null> {
  if (!isBackupId(backupId)) {
    return null;
  }
  const destination = ast.runtime.backups.destination;
  if (destination.startsWith("s3://")) {
    const { bucket, prefix } = parseS3Url(destination);
    const store = s3StoreFromAst(ast, bucket);
    const keyPrefix = `${prefix ? `${prefix}/` : ""}${backupId}/`;
    const objects = await store.listDetailed(keyPrefix);
    if (objects.length === 0) {
      return null;
    }
    return objects.map((object) => ({
      path: `${backupId}/${object.key.slice(keyPrefix.length)}`,
      size: object.size,
      data: async () => {
        const file = await store.get(object.key);
        if (!file) {
          throw new Error(`backup object disappeared: ${object.key}`);
        }
        return file.bytes;
      },
    }));
  }
  const dir = join(resolveRuntimePath(projectDir, destination), backupId);
  try {
    if (!(await stat(dir)).isDirectory()) {
      return null;
    }
  } catch {
    return null;
  }
  const entries: TarEntry[] = [];
  for (const rel of await walkRelative(dir)) {
    const path = join(dir, rel);
    const info = await stat(path);
    entries.push({
      path: `${backupId}/${rel}`,
      size: info.size,
      mtime: info.mtime,
      data: () => streamChunks(path),
    });
  }
  return entries;
}

async function* streamChunks(path: string): AsyncGenerator<Uint8Array> {
  const reader = Bun.file(path).stream().getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      return;
    }
    yield value;
  }
}
