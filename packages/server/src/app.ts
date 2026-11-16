import { join, resolve } from "node:path";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { sql } from "kysely";
import { compileAppYaml, isDevMode, SchemaError, type SchemaAST } from "@bakorin/core";
import { createChangeBus } from "./bus.ts";
import { openPostgres, openSqlite, type BakorinDb } from "./db/dialects.ts";
import { migrateToSchema, type MigrateOptions } from "./db/migrator.ts";
import { createAuthRoutes, verifyAccessToken } from "./auth/routes.ts";
import type { AccessClaims } from "./auth/jwt.ts";
import { bodyLimit } from "hono/body-limit";
import { tokenCutoff } from "./auth/refresh.ts";
import { createAccountRoutes } from "./auth/account.ts";
import { createMailer, mailFrom } from "./mail/create.ts";
import { issueSetupTokenIfNeeded, seedAdminOrLog } from "./auth/seed.ts";
import { createCrudRouter } from "./crud/router.ts";
import { createFileRoutes } from "./files/routes.ts";
import { createLocalFileStore, createS3FileStore, type FileStore } from "./files/store.ts";
import { createMetaRoutes } from "./meta/routes.ts";
import { createAdminRoutes } from "./admin/serve.ts";
import { createDocsRoutes, docsIndex } from "./docs/serve.ts";
import { createBackupRoutes } from "./backup/routes.ts";
import { createAuditRoutes } from "./audit/routes.ts";
import { loadHooks } from "./hooks/loader.ts";
import { subscribeAfterHooks } from "./hooks/after.ts";
import { startWebhookWorker } from "./webhooks/dispatcher.ts";
import { createWebhookRoutes } from "./webhooks/routes.ts";
import { validateMailTemplates } from "./mail/files.ts";
import { createMailApi, startMailWorker } from "./mail/outbox.ts";
import { createMailRoutes } from "./mail/routes.ts";
import type { AppContext } from "./context.ts";
import { runBackup, startBackupScheduler } from "./backup/schedule.ts";
import { resolveRuntimePath } from "./paths.ts";
import { securityHeaders } from "./http/headers.ts";
import { HTTPException } from "hono/http-exception";
import { createMonitor, resolveCommit } from "./monitor/monitor.ts";
import { createStatusRoutes, metricsExtras, readiness } from "./monitor/status.ts";
import { startAlertWorker } from "./monitor/alerts.ts";
import { serverVersion } from "./version.ts";
import { createBrandingRoutes, logBrandingWarnings, validateBrandingFiles } from "./branding/assets.ts";

export interface RuntimeHandles {
  app: Hono;
  ast: SchemaAST;
  db: BakorinDb;
  close: () => Promise<void>;
  reload: (source: string) => Promise<void>;
  context: AppContext;
}

export function createFiles(ast: SchemaAST, projectDir: string): FileStore {
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

export function openDb(ast: SchemaAST, projectDir: string): { db: BakorinDb; close: () => Promise<void> } {
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
  /** Background workers (backups, webhook and mail delivery). Off for one-shot CLI commands like mail preview. */
  workers?: boolean;
}): Promise<RuntimeHandles> {
  const projectDir = resolve(options.projectDir);
  const env = options.env ?? process.env;
  let ast = compileAppYaml(options.yamlSource, { env });
  assertProductionCors(ast, env);
  validateMailTemplates(projectDir, ast.mail);
  validateBrandingFiles(projectDir, ast.branding);
  logBrandingWarnings(ast.branding);
  let opened = openDb(ast, projectDir);
  let files = createFiles(ast, projectDir);
  try {
    await migrateToSchema(opened.db, ast, migrationOptions(ast, opened.db, files, projectDir, env));
  } catch (error) {
    await opened.close();
    throw error;
  }
  await seedAdminOrLog(ast, opened.db, env);
  // Dev mode keeps the open first admin form. Production requires the env seed or a
  // one time setup token printed to the log.
  const requireSetupToken = !isDevMode(env);
  if (requireSetupToken) {
    await issueSetupTokenIfNeeded(ast, opened.db);
  }
  let hooks = await loadHooks(projectDir, ast.runtime.hooksPath);
  const mailer = createMailer(env, mailFrom(env, ast.appName));
  const mail = createMailApi(opened.db, () => context.ast, projectDir);
  const monitor = createMonitor({
    env,
    appName: () => context.ast.appName,
    version: serverVersion(env),
    commit: resolveCommit(env),
  });
  // Webhooks, mail rules and audit rows are written in the same transaction as the
  // record (events/record.ts). The bus only carries post-commit work: after* hooks
  // now, realtime later. A failing subscriber is logged and reported, never fatal.
  const bus = createChangeBus({
    onError: (error, event, meta) => {
      const request = meta.requestId ? ` (request ${meta.requestId})` : "";
      console.error(`[bakorin] after hook for ${event.entity}.${event.op} failed${request}`, error);
      monitor.captureError(error, { requestId: meta.requestId, source: "hook" });
    },
  });
  const context: AppContext = { ast, db: opened.db, bus, hooks, files, projectDir, mailer, mail, monitor, requireSetupToken };
  subscribeAfterHooks(() => context.hooks, opened.db, (handler) => bus.subscribe(handler), mail);
  const workers = options.workers !== false;
  const noop = () => {};
  const stopBackups = workers ? startBackupScheduler({ ast, db: opened.db, files, projectDir }) : noop;
  const stopWebhooks = workers ? startWebhookWorker(opened.db, () => context.ast) : noop;
  const stopMail = workers ? startMailWorker(opened.db, () => context.ast, () => context.mailer) : noop;
  const stopAlerts = workers ? startAlertWorker(context, monitor) : noop;

  const app = new Hono();
  app.use("*", monitor.middleware());
  app.onError((error, c) => {
    if (error instanceof HTTPException) {
      return error.getResponse();
    }
    const requestId = c.get("requestId");
    monitor.captureError(error, {
      requestId,
      method: c.req.method,
      path: new URL(c.req.url).pathname,
      status: 500,
      source: "request",
    });
    console.error(`[bakorin] unhandled error (request ${requestId})`, error);
    return c.json({ error: { code: "internal", message: "Something went wrong on the server.", requestId } }, 500);
  });
  app.use("/api/*", (c, next) => {
    const max = requestBodyLimit(context.ast, c.req.method, new URL(c.req.url).pathname);
    return bodyLimit({
      maxSize: max,
      onError: (ctx) =>
        ctx.json({ error: { code: "payload_too_large", message: `request body is larger than ${max} bytes` } }, 413),
    })(c, next);
  });
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
        c.set("actor", await currentActor(context, claims));
      } catch {
        c.set("actor", null);
      }
    }
    await next();
  });
  app.get("/health", (c) => c.json({ ok: true, app: context.ast.appName }));
  app.get("/healthz", (c) => c.json({ ok: true, app: context.ast.appName }));
  app.get("/ready", async (c) => {
    const result = await readiness(context);
    return c.json(result, result.ok ? 200 : 503, { "cache-control": "no-store" });
  });
  app.get("/metrics", async (c) => {
    if (!monitor.metricsEnabled) {
      return c.notFound();
    }
    if (!monitor.authorizeMetrics(c.req.header("authorization"))) {
      return c.text("unauthorized", 401, { "www-authenticate": 'Bearer realm="metrics"' });
    }
    const body = monitor.metricsText(await metricsExtras(context, monitor));
    return c.body(body, 200, { "content-type": "text/plain; version=0.0.4; charset=utf-8", "cache-control": "no-store" });
  });
  app.route("/api/v1/status", createStatusRoutes(monitor));
  app.get("/docs", () => docsIndex(context.ast));
  app.route("/docs", createDocsRoutes());
  app.route("/api/v1/docs", createDocsRoutes());
  app.route("/api/v1/auth", createAuthRoutes());
  app.route("/api/v1/auth", createAccountRoutes());
  app.route("/api/v1/files", createFileRoutes());
  app.route("/api/v1/backups", createBackupRoutes());
  app.route("/api/v1/audit", createAuditRoutes());
  app.route("/api/v1/webhooks", createWebhookRoutes());
  app.route("/api/v1/mail", createMailRoutes());
  app.route("/api/v1", createMetaRoutes());
  app.route("/api/v1", createCrudRouter());
  app.route("/branding", createBrandingRoutes());
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
      validateMailTemplates(projectDir, next.mail);
      validateBrandingFiles(projectDir, next.branding);
      logBrandingWarnings(next.branding);
      await migrateToSchema(context.db, next, migrationOptions(next, context.db, context.files, projectDir, env));
      context.ast = next;
      context.hooks = await loadHooks(projectDir, next.runtime.hooksPath);
      console.log(`[bakorin] reloaded schema for ${next.appName}`);
    },
    async close() {
      stopBackups();
      stopWebhooks();
      stopMail();
      stopAlerts();
      await monitor.flush();
      await opened.close();
    },
  };
}

/**
 * Removals need BAKORIN_ALLOW_DESTRUCTIVE set to the plan's code. Renames and
 * removals both take a backup first, using the schema that is live now.
 */
export function migrationOptions(
  ast: SchemaAST,
  db: BakorinDb,
  files: FileStore,
  projectDir: string,
  env: Record<string, string | undefined>,
  extra: { allowDestructive?: string } = {},
): MigrateOptions {
  const allow = extra.allowDestructive ?? env.BAKORIN_ALLOW_DESTRUCTIVE;
  return {
    ...(allow ? { allowDestructive: allow } : {}),
    beforeChange: async (previous) => {
      const location = await runBackup({
        ast: { ...previous, appName: ast.appName, runtime: ast.runtime },
        db,
        files,
        projectDir,
        reason: "pre-migration",
      });
      console.log(`[bakorin] backup before schema change written to ${location}`);
      return location;
    },
  };
}

export async function loadProject(projectDir: string, options: { workers?: boolean } = {}): Promise<RuntimeHandles> {
  const yamlPath = join(projectDir, "app.yaml");
  const source = await Bun.file(yamlPath).text();
  return createRuntime({ projectDir, yamlSource: source, workers: options.workers });
}

function corsOptions(origins: string[]) {
  const wildcard = origins.includes("*");
  return {
    origin: wildcard
      ? "*"
      : (origin: string) => (origins.includes(origin) ? origin : ""),
    credentials: true,
    allowHeaders: ["Authorization", "Content-Type", "X-Requested-With", "X-Bakorin-Verify"],
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

/**
 * Turns verified token claims into the request actor, checked against the
 * database: a deleted user gets nothing, a demoted user gets their current role,
 * and tokens issued before a sign out everywhere (password reset, role change,
 * logout all) are rejected.
 */
async function currentActor(context: AppContext, claims: AccessClaims): Promise<{ id: string; role: string } | null> {
  const entity = context.ast.entityMap[context.ast.auth.entity];
  if (!entity || claims.ent !== entity.name) {
    return null;
  }
  const row = await context.db
    .selectFrom(entity.name)
    .select(["id", context.ast.auth.roleField])
    .where("id", "=", claims.sub)
    .executeTakeFirst();
  if (!row) {
    return null;
  }
  const cutoff = await tokenCutoff(context.db, claims.sub);
  if (cutoff && (claims.issuedAtMs ?? 0) < cutoff) {
    return null;
  }
  return { id: claims.sub, role: String((row as Record<string, unknown>)[context.ast.auth.roleField]) };
}

/** JSON request bodies (CRUD, auth, admin) are capped at 1 MiB. */
export const JSON_BODY_LIMIT_BYTES = 1024 * 1024;
/** Multipart framing on top of the file itself. */
export const UPLOAD_OVERHEAD_BYTES = 64 * 1024;

/** The largest body a request may send: uploads get the file limit, everything else 1 MiB. */
export function requestBodyLimit(ast: SchemaAST, method: string, pathname: string): number {
  const path = pathname.replace(/\/+$/, "");
  if (method === "POST" && path === "/api/v1/files") {
    return ast.runtime.files.maxBytes + UPLOAD_OVERHEAD_BYTES;
  }
  return JSON_BODY_LIMIT_BYTES;
}

/** Bun's own ceiling, so oversized bodies are refused before they are buffered. */
export function serverBodyLimit(ast: SchemaAST): number {
  return Math.max(JSON_BODY_LIMIT_BYTES, ast.runtime.files.maxBytes + UPLOAD_OVERHEAD_BYTES);
}
