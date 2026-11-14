#!/usr/bin/env bun
import { mkdir, watch } from "node:fs/promises";
import { join, resolve } from "node:path";
import { generateTypes } from "@bakorin/core";
import { loadProject } from "./app.ts";
import { runBackup } from "./backup/schedule.ts";
import { exportPortable, importPortable, readManifest } from "./backup/archive.ts";
import { restoreSqliteSnapshot } from "./backup/sqlite.ts";
import { migrateToSchema } from "./db/migrator.ts";

import templateYaml from "./templates/app.yaml" with { type: "text" };
import templateHooks from "./templates/hooks.ts" with { type: "text" };

const TEMPLATE_YAML = templateYaml;
const TEMPLATE_HOOKS = templateHooks;

function arg(flag: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index >= 0) {
    return process.argv[index + 1] ?? fallback;
  }
  return fallback;
}

function projectDir(): string {
  return resolve(arg("--dir", process.cwd()) ?? process.cwd());
}

async function cmdInit(): Promise<void> {
  const dir = resolve(process.argv[3] && !process.argv[3].startsWith("-") ? process.argv[3] : projectDir());
  await mkdir(dir, { recursive: true });
  const yamlPath = join(dir, "app.yaml");
  if (await Bun.file(yamlPath).exists()) {
    console.error("app.yaml already exists; refusing to overwrite");
    process.exit(1);
  }
  await Bun.write(yamlPath, TEMPLATE_YAML);
  await Bun.write(join(dir, "hooks.ts"), TEMPLATE_HOOKS);
  await Bun.write(
    join(dir, ".env.example"),
    `JWT_SECRET=change-me-to-a-long-random-string
DATABASE_URL=postgres://user:pass@localhost:5432/bakorin
S3_ACCESS_KEY=
S3_SECRET_KEY=
S3_BUCKET=
S3_ENDPOINT=
`,
  );
  await Bun.write(
    join(dir, ".gitignore"),
    `data
.env
*.db
*.db-wal
*.db-shm
`,
  );
  console.log(`Initialized Bakorin project in ${dir}`);
  console.log("Next: cd there, set JWT_SECRET for production, then run bakorin dev");
}

async function serve(mode: "dev" | "start"): Promise<void> {
  const dir = projectDir();
  const runtime = await loadProject(dir);
  const port = Number(arg("--port", String(runtime.ast.runtime.port)));
  const hostname = runtime.ast.runtime.host;
  console.log(`[bakorin] ${runtime.ast.appName} ${mode} on http://${hostname === "0.0.0.0" ? "127.0.0.1" : hostname}:${port}`);
  console.log(`[bakorin] admin UI http://127.0.0.1:${port}/admin/`);
  const server = Bun.serve({
    port,
    hostname,
    fetch: runtime.app.fetch,
  });
  if (mode === "dev") {
    const yamlPath = join(dir, "app.yaml");
    const hooksPath = join(dir, runtime.ast.runtime.hooksPath ?? "hooks.ts");
    const watcher = watch(dir);
    void (async () => {
      for await (const event of watcher) {
        const name = event.filename ?? "";
        if (name === "app.yaml" || name === "hooks.ts" || yamlPath.endsWith(name) || hooksPath.endsWith(name)) {
          try {
            const source = await Bun.file(yamlPath).text();
            await runtime.reload(source);
          } catch (error) {
            console.error("[bakorin] reload failed; keeping previous schema", error);
          }
        }
      }
    })();
  }
  process.on("SIGINT", async () => {
    server.stop();
    await runtime.close();
    process.exit(0);
  });
}

async function cmdTypegen(): Promise<void> {
  const dir = projectDir();
  const runtime = await loadProject(dir);
  const out = resolve(arg("-o", arg("--out", join(dir, "bakorin.gen.ts"))) ?? join(dir, "bakorin.gen.ts"));
  await Bun.write(out, generateTypes(runtime.ast));
  console.log(`wrote ${out}`);
  await runtime.close();
}

async function cmdBackup(): Promise<void> {
  const dir = projectDir();
  const runtime = await loadProject(dir);
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

async function cmdExport(): Promise<void> {
  const dir = projectDir();
  const runtime = await loadProject(dir);
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

async function cmdRestore(): Promise<void> {
  const dir = projectDir();
  const src = process.argv[3];
  if (!src) {
    console.error("usage: bakorin restore <backup-dir>");
    process.exit(1);
  }
  const source = resolve(src);
  const manifest = await readManifest(source);
  const runtime = await loadProject(dir);
  if (manifest.kind === "sqlite-snapshot") {
    await runtime.close();
    await restoreSqliteSnapshot({
      src: source,
      dbPath: join(dir, runtime.ast.runtime.sqlitePath),
      uploadsPath: join(dir, runtime.ast.runtime.files.path),
    });
    console.log("sqlite snapshot restored");
    return;
  }
  await migrateToSchema(runtime.db, runtime.ast);
  await importPortable({ src: source, ast: runtime.ast, db: runtime.db, files: runtime.context.files });
  console.log("portable backup restored");
  await runtime.close();
}

async function cmdImport(): Promise<void> {
  const dir = projectDir();
  const src = process.argv[3];
  if (!src) {
    console.error("usage: bakorin import <export-dir>");
    process.exit(1);
  }
  const runtime = await loadProject(dir);
  await importPortable({ src: resolve(src), ast: runtime.ast, db: runtime.db, files: runtime.context.files });
  console.log("portable archive imported");
  await runtime.close();
}

function help(): void {
  console.log(`bakorin <command>

Commands:
  init [dir]          Write a starter app.yaml, hooks.ts, and .env.example
  dev                 Run with hot reload of app.yaml / hooks.ts
  start               Run without watching
  typegen [-o file]   Write bakorin.gen.ts
  backup [dir]        Consistent snapshot (SQLite VACUUM INTO) plus portable export
  restore <dir>       Restore a snapshot or portable archive
  export [dir]        Portable NDJSON archive for moving SQLite <-> Postgres
  import <dir>        Import a portable archive into the current dialect

A project is one folder: app.yaml, optional hooks.ts, data/, uploads.
`);
}

const command = process.argv[2] ?? "help";
switch (command) {
  case "init":
    await cmdInit();
    break;
  case "dev":
    await serve("dev");
    break;
  case "start":
    await serve("start");
    break;
  case "typegen":
    await cmdTypegen();
    break;
  case "backup":
    await cmdBackup();
    break;
  case "restore":
    await cmdRestore();
    break;
  case "export":
    await cmdExport();
    break;
  case "import":
    await cmdImport();
    break;
  case "help":
  case "--help":
  case "-h":
    help();
    break;
  default:
    console.error(`unknown command ${command}`);
    help();
    process.exit(1);
}
