#!/usr/bin/env bun
import { mkdir, watch } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  buildSchemaGraph,
  compileAppYaml,
  DEV_JWT_SECRET,
  formatAppYamlError,
  generateTypes,
  isAppYamlValidationError,
  schemaToJson,
  schemaToMermaid,
} from "@bakorin/core";
import { loadProject } from "./app.ts";
import { createDebounced } from "./dev-watch.ts";
import { applyProjectEnv } from "./env-files.ts";
import { runBackup } from "./backup/schedule.ts";
import { exportPortable, importPortable, readManifest } from "./backup/archive.ts";
import { restoreSqliteSnapshot } from "./backup/sqlite.ts";
import { migrateToSchema } from "./db/migrator.ts";
import { resolveRuntimePath } from "./paths.ts";

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
  await Bun.write(join(dir, ".env.example"), envExampleTemplate());
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

function reportValidationError(error: unknown, context: "startup" | "reload"): void {
  if (isAppYamlValidationError(error)) {
    if (context === "reload") {
      console.error("[bakorin] reload failed; keeping previous schema");
    }
    console.error(formatAppYamlError(error));
    return;
  }
  if (context === "reload") {
    console.error("[bakorin] reload failed; keeping previous schema");
    console.error(error instanceof Error ? error.message : error);
    return;
  }
  console.error(error);
}

function envExampleTemplate(): string {
  return `JWT_SECRET=change-me-to-a-long-random-string
PORT=4371
APP_URL=http://localhost:4321
CORS_ORIGINS=http://localhost:4321,http://localhost:3000

# First admin. Leave empty to create one at /admin/ on first run.
BAKORIN_ADMIN_EMAIL=
BAKORIN_ADMIN_PASSWORD=
BAKORIN_ADMIN_NAME=

MAIL_DRIVER=log
MAIL_FROM=

# --- Optional: production, Railway, S3, Postgres, extra mail ---
BAKORIN_DATA_DIR=
BAKORIN_ENV=
NODE_ENV=
DATABASE_URL=
JWT_SECRET_PREVIOUS=
# Placeholder only. Paste a Resend API key locally. Never commit a real key.
RESEND_API_KEY=
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_SECURE=false
BUCKET=
S3_BUCKET=
S3_ENDPOINT=
S3_ACCESS_KEY=
S3_SECRET_KEY=
S3_REGION=auto
S3_ADDRESSING_STYLE=path
S3_FORCE_PATH_STYLE=true
AWS_ENDPOINT_URL=
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_DEFAULT_REGION=auto
`;
}

async function loadOrExit(dir: string) {
  await applyProjectEnv(dir);
  try {
    return await loadProject(dir);
  } catch (error) {
    reportValidationError(error, "startup");
    process.exit(1);
  }
}

async function serve(mode: "dev" | "start"): Promise<void> {
  const dir = projectDir();
  const runtime = await loadOrExit(dir);
  const port = Number(arg("--port", String(runtime.ast.runtime.port)));
  const hostname = runtime.ast.runtime.host;
  console.log(`[bakorin] ${runtime.ast.appName} ${mode} on http://${hostname === "0.0.0.0" ? "127.0.0.1" : hostname}:${port}`);
  console.log(`[bakorin] admin UI http://127.0.0.1:${port}/admin/`);
  if (mode === "dev" && runtime.ast.runtime.jwtSecret === DEV_JWT_SECRET) {
    console.warn(
      "[bakorin] WARNING: using the default JWT secret. Set JWT_SECRET in this project's .env before going beyond local experiments.",
    );
  }
  const server = Bun.serve({
    port,
    hostname,
    fetch: runtime.app.fetch,
  });
  if (mode === "dev") {
    const yamlPath = join(dir, "app.yaml");
    const hooksPath = join(dir, runtime.ast.runtime.hooksPath ?? "hooks.ts");
    const debounced = createDebounced(150, async () => {
      try {
        const source = await Bun.file(yamlPath).text();
        await runtime.reload(source);
      } catch (error) {
        reportValidationError(error, "reload");
      }
    });
    const watcher = watch(dir);
    void (async () => {
      for await (const event of watcher) {
        const name = event.filename ?? "";
        if (name === "app.yaml" || name === "hooks.ts" || yamlPath.endsWith(name) || hooksPath.endsWith(name)) {
          debounced.trigger();
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

async function cmdSchema(): Promise<void> {
  const dir = projectDir();
  await applyProjectEnv(dir);
  const yamlPath = join(dir, "app.yaml");
  if (!(await Bun.file(yamlPath).exists())) {
    console.error(`no app.yaml in ${dir}`);
    process.exit(1);
  }
  const format = (arg("--format", "mermaid") ?? "mermaid").toLowerCase();
  try {
    const ast = compileAppYaml(await Bun.file(yamlPath).text());
    const graph = buildSchemaGraph(ast);
    switch (format) {
      case "mermaid":
        process.stdout.write(schemaToMermaid(graph));
        break;
      case "json":
        process.stdout.write(schemaToJson(graph));
        break;
      default:
        console.error("usage: bakorin schema --format mermaid|json");
        process.exit(1);
    }
  } catch (error) {
    reportValidationError(error, "startup");
    process.exit(1);
  }
}

async function cmdTypegen(): Promise<void> {
  const dir = projectDir();
  const runtime = await loadOrExit(dir);
  const out = resolve(arg("-o", arg("--out", join(dir, "bakorin.gen.ts"))) ?? join(dir, "bakorin.gen.ts"));
  await Bun.write(out, generateTypes(runtime.ast));
  console.log(`wrote ${out}`);
  await runtime.close();
}

async function cmdBackup(): Promise<void> {
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

async function cmdExport(): Promise<void> {
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

async function cmdRestore(): Promise<void> {
  const dir = projectDir();
  const src = process.argv[3];
  if (!src) {
    console.error("usage: bakorin restore <backup-dir>");
    process.exit(1);
  }
  const source = resolve(src);
  const manifest = await readManifest(source);
  const runtime = await loadOrExit(dir);
  if (manifest.kind === "sqlite-snapshot") {
    await runtime.close();
    await restoreSqliteSnapshot({
      src: source,
      dbPath: resolveRuntimePath(dir, runtime.ast.runtime.sqlitePath),
      uploadsPath: resolveRuntimePath(dir, runtime.ast.runtime.files.path),
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
  const runtime = await loadOrExit(dir);
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
  schema [--format mermaid|json]  Print the schema as Mermaid or JSON
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
  case "schema":
    await cmdSchema();
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
