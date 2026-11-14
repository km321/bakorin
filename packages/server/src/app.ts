import { join, resolve } from "node:path";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { sql } from "kysely";
import { compileAppYaml, type SchemaAST } from "@bakorin/core";
import { createChangeBus } from "./bus.ts";
import { openPostgres, openSqlite, type BakorinDb } from "./db/dialects.ts";
import { migrateToSchema } from "./db/migrator.ts";
import { createAuthRoutes, verifyAccessToken } from "./auth/routes.ts";
import { seedAdminIfRequested } from "./auth/seed.ts";
import { createCrudRouter } from "./crud/router.ts";
import { createFileRoutes } from "./files/routes.ts";
import { createLocalFileStore, createS3FileStore, type FileStore } from "./files/store.ts";
import { createMetaRoutes } from "./meta/routes.ts";
import { createAdminRoutes } from "./admin/serve.ts";
import { loadHooks } from "./hooks/loader.ts";
import { subscribeAfterHooks } from "./hooks/after.ts";
import { subscribeWebhooks } from "./webhooks/dispatcher.ts";
import type { AppContext } from "./context.ts";
import { startBackupScheduler } from "./backup/schedule.ts";
import { resolveRuntimePath } from "./paths.ts";

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
  let opened = openDb(ast, projectDir);
  await migrateToSchema(opened.db, ast);
  await seedAdminIfRequested(ast, opened.db, env);
  const bus = createChangeBus();
  let hooks = await loadHooks(projectDir, ast.runtime.hooksPath);
  let files = createFiles(ast, projectDir);
  const context: AppContext = { ast, db: opened.db, bus, hooks, files, projectDir };
  subscribeWebhooks(ast, (handler) => bus.subscribe(handler));
  subscribeAfterHooks(hooks, opened.db, (handler) => bus.subscribe(handler));
  const stopBackups = startBackupScheduler({ ast, db: opened.db, files, projectDir });

  const app = new Hono();
  app.use(
    "*",
    cors({
      origin: ast.runtime.corsOrigins.includes("*") ? "*" : ast.runtime.corsOrigins,
      credentials: true,
    }),
  );
  app.use("*", async (c, next) => {
    c.set("app", context);
    c.set("actor", null);
    const header = c.req.header("authorization");
    const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
    if (token) {
      try {
        const claims = await verifyAccessToken(token, context.ast.runtime.jwtSecret);
        c.set("actor", { id: claims.sub, role: claims.role });
      } catch {
        c.set("actor", null);
      }
    }
    await next();
  });
  app.get("/health", (c) => c.json({ ok: true, app: context.ast.appName }));
  app.get("/healthz", (c) => c.json({ ok: true, app: context.ast.appName }));
  app.route("/api/v1/auth", createAuthRoutes());
  app.route("/api/v1/files", createFileRoutes());
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
      await opened.close();
    },
  };
}

export async function loadProject(projectDir: string): Promise<RuntimeHandles> {
  const yamlPath = join(projectDir, "app.yaml");
  const source = await Bun.file(yamlPath).text();
  return createRuntime({ projectDir, yamlSource: source });
}
