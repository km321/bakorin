import { cp, mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
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
  copyAllTo(destDir: string): Promise<void>;
  importAllFrom(srcDir: string): Promise<void>;
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
    async copyAllTo(destDir) {
      await mkdir(destDir, { recursive: true });
      try {
        await cp(base, destDir, { recursive: true });
      } catch {
        // empty store
      }
    },
    async importAllFrom(srcDir) {
      await mkdir(base, { recursive: true });
      try {
        await cp(srcDir, base, { recursive: true });
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
    async copyAllTo(destDir) {
      await mkdir(destDir, { recursive: true });
      const listed = await client.list();
      const contents = (listed as { contents?: Array<{ key?: string }> }).contents ?? [];
      for (const item of contents) {
        if (!item.key) {
          continue;
        }
        const file = client.file(item.key);
        const bytes = new Uint8Array(await file.arrayBuffer());
        const path = join(destDir, item.key);
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, bytes);
      }
    },
    async importAllFrom(srcDir) {
      async function walk(dir: string, prefix: string): Promise<void> {
        let entries: string[] = [];
        try {
          entries = await readdir(dir);
        } catch {
          return;
        }
        for (const entry of entries) {
          const path = join(dir, entry);
          const file = Bun.file(path);
          const stat = await file.stat().catch(() => null);
          if (!stat) {
            continue;
          }
          if (stat.isDirectory()) {
            await walk(path, prefix ? `${prefix}/${entry}` : entry);
          } else {
            const key = prefix ? `${prefix}/${entry}` : entry;
            await client.write(key, await readFile(path));
          }
        }
      }
      await walk(srcDir, "");
    },
  };
}
