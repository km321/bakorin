import { join, resolve } from "node:path";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { sql } from "kysely";
import { compileAppYaml, SchemaError, type SchemaAST } from "@bakorin/core";
import { createChangeBus } from "./bus.ts";
import { openPostgres, openSqlite, type BakorinDb } from "./db/dialects.ts";
import { migrateToSchema } from "./db/migrator.ts";
import { createAuthRoutes, verifyAccessToken } from "./auth/routes.ts";
import { createAccountRoutes } from "./auth/account.ts";
import { createMailer, mailFrom } from "./mail/create.ts";
import { seedAdminOrLog } from "./auth/seed.ts";
import { createCrudRouter } from "./crud/router.ts";
import { createFileRoutes } from "./files/routes.ts";
import { createLocalFileStore, createS3FileStore, type FileStore } from "./files/store.ts";
import { createMetaRoutes } from "./meta/routes.ts";
import { createAdminRoutes } from "./admin/serve.ts";
import { createDocsRoutes, docsIndex } from "./docs/serve.ts";
import { createBackupRoutes } from "./backup/routes.ts";
import { createAuditRoutes } from "./audit/routes.ts";
import { subscribeAudit } from "./audit/log.ts";
import { loadHooks } from "./hooks/loader.ts";
import { subscribeAfterHooks } from "./hooks/after.ts";
import { startWebhookWorker, subscribeWebhooks } from "./webhooks/dispatcher.ts";
import { createWebhookRoutes } from "./webhooks/routes.ts";
import type { AppContext } from "./context.ts";
import { startBackupScheduler } from "./backup/schedule.ts";
import { resolveRuntimePath } from "./paths.ts";
import { securityHeaders } from "./http/headers.ts";

export interface RuntimeHandles {
  app: Hono;
  ast: SchemaAST;
  db: BakorinDb;
  close: () => Promise<void>;
  reload: (source: string) => Promise<void>;
  context: AppContext;
}

function createFiles(ast: SchemaAST, projectDir: string): FileStore {
  if (ast.runtime.files.driver === "s3") {
    return createS3FileStore({
      bucket: ast.runtime.files.bucket ?? "",
      accessKey: ast.runtime.files.accessKey ?? "",
      secretKey: ast.runtime.files.secretKey ?? "",
      endpoint: ast.runtime.files.endpoint,
      region: ast.runtime.files.region,
      virtualHostedStyle: ast.runtime.files.virtualHostedStyle,
    });
  }
  return createLocalFileStore(resolveRuntimePath(projectDir, ast.runtime.files.path));
}

function openDb(ast: SchemaAST, projectDir: string): { db: BakorinDb; close: () => Promise<void> } {
  if (ast.runtime.dialect === "postgres") {
    const { db } = openPostgres(ast.runtime.postgresUrl ?? "");
    return {
      db,
      close: async () => {
        await db.destroy();
      },
    };
  }
  const { db } = openSqlite(resolveRuntimePath(projectDir, ast.runtime.sqlitePath));
  return {
    db,
    close: async () => {
      try {
        await sql`pragma wal_checkpoint(FULL)`.execute(db);
      } catch {
        // postgres or already closed
      }
      await db.destroy();
    },
  };
}

export async function createRuntime(options: {
  projectDir: string;
  yamlSource: string;
  env?: Record<string, string | undefined>;
}): Promise<RuntimeHandles> {
  const projectDir = resolve(options.projectDir);
  const env = options.env ?? process.env;
  let ast = compileAppYaml(options.yamlSource, { env });
  assertProductionCors(ast, env);
  let opened = openDb(ast, projectDir);
  await migrateToSchema(opened.db, ast);
  await seedAdminOrLog(ast, opened.db, env);
  const bus = createChangeBus();
  let hooks = await loadHooks(projectDir, ast.runtime.hooksPath);
  let files = createFiles(ast, projectDir);
  const mailer = createMailer(env, mailFrom(env, ast.appName));
  const context: AppContext = { ast, db: opened.db, bus, hooks, files, projectDir, mailer };
  subscribeWebhooks(() => context.ast, opened.db, (handler) => bus.subscribe(handler));
  subscribeAfterHooks(hooks, opened.db, (handler) => bus.subscribe(handler));
  subscribeAudit(ast, opened.db, (handler) => bus.subscribe(handler));
  const stopBackups = startBackupScheduler({ ast, db: opened.db, files, projectDir });
  const stopWebhooks = startWebhookWorker(opened.db, () => context.ast);

  const app = new Hono();
  app.use("*", cors(corsOptions(ast.runtime.corsOrigins)));
  app.use("*", securityHeaders());
  app.use("*", async (c, next) => {
    c.set("app", context);
    c.set("actor", null);
    const header = c.req.header("authorization");
    const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
    if (token) {
      try {
        const claims = await verifyAccessToken(token, context.ast.runtime.jwtSecret, context.ast.runtime.jwtSecretPrevious);
        c.set("actor", { id: claims.sub, role: claims.role });
      } catch {
        c.set("actor", null);
      }
    }
    await next();
  });
  app.get("/health", (c) => c.json({ ok: true, app: context.ast.appName }));
  app.get("/healthz", (c) => c.json({ ok: true, app: context.ast.appName }));
  app.get("/docs", () => docsIndex());
  app.route("/docs", createDocsRoutes());
  app.route("/api/v1/docs", createDocsRoutes());
  app.route("/api/v1/auth", createAuthRoutes());
  app.route("/api/v1/auth", createAccountRoutes());
  app.route("/api/v1/files", createFileRoutes());
  app.route("/api/v1/backups", createBackupRoutes());
  app.route("/api/v1/audit", createAuditRoutes());
  app.route("/api/v1/webhooks", createWebhookRoutes());
  app.route("/api/v1", createMetaRoutes());
  app.route("/api/v1", createCrudRouter());
  app.route("/admin", createAdminRoutes());
  hooks.routes?.(app);

  return {
    app,
    get ast() {
      return context.ast;
    },
    get db() {
      return context.db;
    },
    context,
    async reload(source: string) {
      const next = compileAppYaml(source, { env });
      await migrateToSchema(context.db, next);
      context.ast = next;
      context.hooks = await loadHooks(projectDir, next.runtime.hooksPath);
      console.log(`[bakorin] reloaded schema for ${next.appName}`);
    },
    async close() {
      stopBackups();
      stopWebhooks();
      await opened.close();
    },
  };
}

export async function loadProject(projectDir: string): Promise<RuntimeHandles> {
  const yamlPath = join(projectDir, "app.yaml");
  const source = await Bun.file(yamlPath).text();
  return createRuntime({ projectDir, yamlSource: source });
}

function corsOptions(origins: string[]) {
  const wildcard = origins.includes("*");
  return {
    origin: wildcard
      ? "*"
      : (origin: string) => (origins.includes(origin) ? origin : ""),
    credentials: true,
    allowHeaders: ["Authorization", "Content-Type", "X-Requested-With"],
    allowMethods: ["GET", "HEAD", "PUT", "POST", "DELETE", "PATCH", "OPTIONS"],
    maxAge: 86400,
  };
}

function assertProductionCors(ast: SchemaAST, env: Record<string, string | undefined>): void {
  const production = env.NODE_ENV === "production" || env.BAKORIN_ENV === "production";
  if (!production || !ast.runtime.corsOrigins.includes("*")) {
    return;
  }
  if (env.BAKORIN_ALLOW_ANY_ORIGIN === "true") {
    console.warn("[bakorin] BAKORIN_ALLOW_ANY_ORIGIN=true: allowing CORS origin * in production");
    return;
  }
  throw new SchemaError(
    'CORS origin "*" is not allowed in production. Set CORS_ORIGINS to an explicit comma-separated list, or set BAKORIN_ALLOW_ANY_ORIGIN=true',
  );
}
