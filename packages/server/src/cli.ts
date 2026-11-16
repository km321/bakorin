#!/usr/bin/env bun
import { mkdir, rm, stat, watch } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  buildSchemaGraph,
  compileAppYaml,
  DestructiveChangeError,
  DEV_JWT_SECRET,
  isDevMode,
  diffSchemas,
  formatPlan,
  formatAppYamlError,
  generateTypes,
  isAppYamlValidationError,
  schemaToJson,
  schemaToMermaid,
} from "@bakorin/core";
import { createFiles, loadProject, migrationOptions, openDb, serverBodyLimit } from "./app.ts";
import { createDebounced } from "./dev-watch.ts";
import { applyProjectEnv } from "./env-files.ts";
import { installProcessSafety } from "./monitor/process-safety.ts";
import { runBackup } from "./backup/schedule.ts";
import { exportPortable, importPortable, readManifest, restoreProjectAssets } from "./backup/archive.ts";
import { restoreSqliteSnapshot } from "./backup/sqlite.ts";
import { countPendingDeliveries, discardPendingDeliveries } from "./backup/pending.ts";
import { migrateToSchema, planMigration } from "./db/migrator.ts";
import { backupSchema, verifyBackup, type VerifyResult } from "./backup/integrity.ts";
import { readTar } from "./backup/tar.ts";
import { resolveRuntimePath } from "./paths.ts";
import { buildPreview, PreviewError } from "./mail/routes.ts";
import { listTemplates } from "./mail/files.ts";

import templateYaml from "./templates/app.yaml" with { type: "text" };
import templateHooks from "./templates/hooks.ts" with { type: "text" };

const TEMPLATE_YAML = templateYaml;
const TEMPLATE_HOOKS = templateHooks as unknown as string;

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
  if (error instanceof DestructiveChangeError) {
    if (context === "reload") {
      console.error("[bakorin] reload stopped; keeping previous schema");
    }
    console.error(error.message);
    return;
  }
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
  return `# Required for bakorin start: 32+ random characters. Generate one with: openssl rand -base64 48
# bakorin dev works without it and prints a warning.
JWT_SECRET=
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
# Set to 1 behind one proxy such as Railway, or a comma list of proxy CIDRs. Empty trusts no proxy.
TRUST_PROXY=
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

async function loadOrExit(dir: string, options: { workers?: boolean } = {}) {
  await applyProjectEnv(dir);
  try {
    return await loadProject(dir, options);
  } catch (error) {
    reportValidationError(error, "startup");
    process.exit(1);
  }
}

async function serve(mode: "dev" | "start"): Promise<void> {
  const dir = projectDir();
  // Load the project .env first so a BAKORIN_ENV in it is checked too.
  await applyProjectEnv(dir);
  if (mode === "dev") {
    // The only place the public dev JWT secret is allowed. `start` is always production.
    process.env.BAKORIN_ENV = "development";
  } else if (isDevMode(process.env)) {
    console.error(
      "[bakorin] `bakorin start` is for production, but BAKORIN_ENV or BAKORIN_TEST asks for development. Use `bakorin dev` locally, or unset them.",
    );
    process.exit(1);
  }
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
  let server: ReturnType<typeof Bun.serve>;
  try {
    server = Bun.serve({
      port,
      hostname,
      fetch: runtime.app.fetch,
      maxRequestBodySize: serverBodyLimit(runtime.ast),
    });
  } catch (error) {
    console.error(`[bakorin] could not listen on ${hostname}:${port}: ${error instanceof Error ? error.message : String(error)}`);
    await runtime.close().catch(() => undefined);
    process.exit(1);
  }
  // Installed only after the server is listening, so a boot failure still exits.
  installProcessSafety(runtime.context.monitor);
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
  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) {
      return;
    }
    stopping = true;
    console.log(`[bakorin] ${signal}: finishing in-flight requests, then stopping`);
    const force = setTimeout(() => process.exit(0), 15_000);
    try {
      // Realtime streams never finish on their own: tell them to reconnect elsewhere first.
      await runtime.context.realtime?.drain();
      void server.stop();
      const deadline = Date.now() + 10_000;
      while (server.pendingRequests > 0 && Date.now() < deadline) {
        await Bun.sleep(50);
      }
      await runtime.close();
    } finally {
      clearTimeout(force);
      process.exit(0);
    }
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
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
    // Reads the schema only; no server starts, so the JWT secret is not needed.
    const ast = compileAppYaml(await Bun.file(yamlPath).text(), { production: false });
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

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

/** Opens the project's database and schema without migrating, for planning. */
async function openForPlan(dir: string) {
  await applyProjectEnv(dir);
  const yamlPath = join(dir, "app.yaml");
  if (!(await Bun.file(yamlPath).exists())) {
    console.error(`no app.yaml in ${dir}`);
    process.exit(1);
  }
  let ast;
  try {
    // Type generation reads the schema only; no server starts.
    ast = compileAppYaml(await Bun.file(yamlPath).text(), { env: process.env, production: false });
  } catch (error) {
    reportValidationError(error, "startup");
    process.exit(1);
  }
  const opened = openDb(ast, dir);
  return { ast, opened };
}

async function cmdMigrate(): Promise<void> {
  const dir = projectDir();
  const { ast, opened } = await openForPlan(dir);
  const allow = arg("--allow-destructive");
  try {
    const planned = await planMigration(opened.db, ast);
    const { plan, confirmCode } = planned;
    if (hasFlag("--plan")) {
      console.log(`Migration plan for ${ast.appName} (${ast.runtime.dialect})`);
      console.log("");
      console.log(formatPlan(plan));
      if (plan.abort.length > 0) {
        console.log("");
        console.log("Blocked changes stop the server from starting. Change app.yaml so they are not needed.");
      }
      if (confirmCode) {
        console.log("");
        console.log(`Confirm code: ${confirmCode}`);
        console.log(`Apply with: bakorin migrate --allow-destructive ${confirmCode}`);
        console.log("A backup is taken automatically before anything is changed.");
      }
      return;
    }
    if (plan.abort.length > 0) {
      console.error(formatPlan(plan));
      console.error("");
      console.error("Nothing was changed. Change app.yaml so the blocked changes are not needed.");
      process.exitCode = 1;
      return;
    }
    const files = createFiles(ast, dir);
    const result = await migrateToSchema(
      opened.db,
      ast,
      migrationOptions(ast, opened.db, files, dir, process.env, allow ? { allowDestructive: allow } : {}),
    );
    const total = result.plan.auto.length + result.plan.safe.length + result.plan.deprecate.length;
    console.log(total === 0 ? "Schema is up to date." : `Applied ${total} change${total === 1 ? "" : "s"}.`);
    if (result.backup) {
      console.log(`Backup taken first: ${result.backup}`);
    }
  } catch (error) {
    if (error instanceof DestructiveChangeError) {
      console.error(error.message);
      process.exitCode = 2;
      return;
    }
    throw error;
  } finally {
    await opened.close();
  }
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

async function cmdRestore(): Promise<void> {
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

async function cmdMail(): Promise<void> {
  const sub = process.argv[3];
  const dir = projectDir();
  if (sub === "list") {
    for (const template of listTemplates(dir)) {
      const parts = [template.html ? "html" : "", template.text ? "txt" : "", template.subject ? "subject" : ""];
      console.log(`${template.name}  (${parts.filter(Boolean).join(", ")})`);
    }
    return;
  }
  const template = process.argv[4];
  if (sub !== "preview" || !template || template.startsWith("-")) {
    console.error("usage: bakorin mail preview <template|rule> [--entity orders] [--record <id>] [--format html|text|json]");
    console.error("       bakorin mail list");
    process.exit(1);
  }
  const runtime = await loadOrExit(dir, { workers: false });
  const format = (arg("--format", "html") ?? "html").toLowerCase();
  try {
    const isRule = (runtime.ast.mail ?? []).some((rule) => rule.id === template);
    const preview = await buildPreview(runtime.context, {
      template: isRule ? undefined : template,
      ruleId: isRule ? template : undefined,
      entity: arg("--entity"),
      recordId: arg("--record"),
    });
    if (format === "json") {
      const { subject, html, text } = preview.rendered;
      const out = { template: preview.template, ruleId: preview.ruleId, sample: preview.sample, to: preview.to, subject, text, html };
      process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
    } else if (format === "text") {
      process.stdout.write(`Subject: ${preview.rendered.subject}\n\n${preview.rendered.text}\n`);
    } else {
      process.stdout.write(`${preview.rendered.html}\n`);
    }
  } catch (error) {
    if (error instanceof PreviewError) {
      console.error(error.message);
      await runtime.close();
      process.exit(1);
    }
    throw error;
  }
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
  restore <dir|file.tar.gz> [--dry-run] [--discard-pending]
                      Verify checksums, back up current data, then restore.
                      --discard-pending drops queued mail and webhooks from the backup.
                      --dry-run only verifies and shows what would change
  migrate [--plan] [--allow-destructive <code>]
                      Show or apply schema changes. Removals need the code
                      printed by --plan; a backup is taken first
  export [dir]        Portable NDJSON archive for moving SQLite <-> Postgres
  import <dir>        Import a portable archive into the current dialect
  mail list           List templates in mail/
  mail preview <template|rule> [--record <id>] [--entity name] [--format html|text|json]
                      Render a mail template against a sample or real record

A project is one folder: app.yaml, optional hooks.ts, mail/, branding/, data/, uploads.
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
  case "migrate":
    await cmdMigrate();
    break;
  case "export":
    await cmdExport();
    break;
  case "import":
    await cmdImport();
    break;
  case "mail":
    await cmdMail();
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
