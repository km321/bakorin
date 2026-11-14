import { cp, mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { S3Client } from "bun";

export interface StoredFile {
  key: string;
  bytes: Uint8Array;
  contentType: string;
}

export interface FileStore {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<StoredFile | null>;
  delete(key: string): Promise<void>;
  list(prefix?: string): Promise<string[]>;
  copyAllTo(destDir: string): Promise<void>;
  importAllFrom(srcDir: string, keyPrefix?: string): Promise<void>;
}

export function parseS3Url(dest: string): { bucket: string; prefix: string } {
  const url = new URL(dest);
  if (url.protocol !== "s3:") {
    throw new Error(`not an s3 url: ${dest}`);
  }
  return {
    bucket: url.host,
    prefix: url.pathname.replace(/^\/+|\/+$/g, ""),
  };
}

async function walkFiles(root: string): Promise<string[]> {
  let entries: Array<{ name: string; isDirectory(): boolean }> = [];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(path)));
    } else {
      files.push(path);
    }
  }
  return files;
}

export function createLocalFileStore(root: string): FileStore {
  const base = resolve(root);
  return {
    async put(key, bytes) {
      const path = join(base, key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, bytes);
    },
    async get(key) {
      const path = join(base, key);
      const file = Bun.file(path);
      if (!(await file.exists())) {
        return null;
      }
      return { key, bytes: new Uint8Array(await file.arrayBuffer()), contentType: file.type || "application/octet-stream" };
    },
    async delete(key) {
      const path = join(base, key);
      try {
        await unlink(path);
      } catch {
        // ignore missing
      }
    },
    async list(prefix = "") {
      const files = await walkFiles(base);
      const keys = files.map((path) => relative(base, path).split("\\").join("/"));
      if (!prefix) {
        return keys;
      }
      return keys.filter((key) => key === prefix || key.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`) || key.startsWith(prefix));
    },
    async copyAllTo(destDir) {
      await mkdir(destDir, { recursive: true });
      try {
        await cp(base, destDir, { recursive: true });
      } catch {
        // empty store
      }
    },
    async importAllFrom(srcDir, keyPrefix = "") {
      await mkdir(base, { recursive: true });
      const dest = keyPrefix ? join(base, keyPrefix) : base;
      try {
        await mkdir(dest, { recursive: true });
        await cp(srcDir, dest, { recursive: true });
      } catch {
        // empty
      }
    },
  };
}

export function createS3FileStore(options: {
  bucket: string;
  accessKey: string;
  secretKey: string;
  endpoint?: string;
  region?: string;
}): FileStore {
  const client = new S3Client({
    bucket: options.bucket,
    accessKeyId: options.accessKey,
    secretAccessKey: options.secretKey,
    endpoint: options.endpoint,
    region: options.region ?? "auto",
  });

  async function listAll(prefix = ""): Promise<string[]> {
    const keys: string[] = [];
    let startAfter: string | undefined;
    for (let page = 0; page < 100; page += 1) {
      const listed = await client.list({
        prefix: prefix || undefined,
        maxKeys: 1000,
        startAfter,
      });
      const contents = listed.contents ?? [];
      for (const item of contents) {
        if (item.key) {
          keys.push(item.key);
        }
      }
      if (!listed.isTruncated || contents.length === 0) {
        break;
      }
      startAfter = contents.at(-1)?.key;
      if (!startAfter) {
        break;
      }
    }
    return keys;
  }

  return {
    async put(key, bytes, contentType) {
      await client.write(key, bytes, { type: contentType });
    },
    async get(key) {
      try {
        const file = client.file(key);
        const bytes = new Uint8Array(await file.arrayBuffer());
        return { key, bytes, contentType: file.type || "application/octet-stream" };
      } catch {
        return null;
      }
    },
    async delete(key) {
      await client.delete(key);
    },
    list: listAll,
    async copyAllTo(destDir) {
      await mkdir(destDir, { recursive: true });
      for (const key of await listAll()) {
        const file = client.file(key);
        const bytes = new Uint8Array(await file.arrayBuffer());
        const path = join(destDir, key);
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, bytes);
      }
    },
    async importAllFrom(srcDir, keyPrefix = "") {
      const prefix = keyPrefix.replace(/\/+$/, "");
      const files = await walkFiles(srcDir);
      for (const path of files) {
        const rel = relative(srcDir, path).split("\\").join("/");
        const key = prefix ? `${prefix}/${rel}` : rel;
        await client.write(key, await readFile(path));
      }
    },
  };
}

export async function pruneS3Backups(store: FileStore, prefix: string, retain: number): Promise<void> {
  const root = prefix.replace(/\/+$/, "");
  const listPrefix = root ? `${root}/` : "";
  const keys = await store.list(listPrefix);
  const stamps = new Set<string>();
  for (const key of keys) {
    const rest = listPrefix && key.startsWith(listPrefix) ? key.slice(listPrefix.length) : key;
    const stamp = rest.split("/")[0];
    if (stamp && /^\d{4}-/.test(stamp)) {
      stamps.add(stamp);
    }
  }
  const sorted = [...stamps].sort();
  const extra = sorted.length - retain;
  if (extra <= 0) {
    return;
  }
  for (const stamp of sorted.slice(0, extra)) {
    const stampPrefix = `${listPrefix}${stamp}/`;
    for (const key of await store.list(stampPrefix)) {
      await store.delete(key);
    }
  }
}
