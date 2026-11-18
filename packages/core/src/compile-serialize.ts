/** Stored schema: secrets are redacted before the AST is written to the database. */

import { SchemaError } from "./errors.ts";
import { MAIL_DEFAULT_RETAIN_DAYS, MCP_DEFAULTS, REALTIME_DEFAULTS, type RuntimeAST, SCHEMA_AST_VERSION, type SchemaAST, WEBHOOK_DEFAULT_MAX_ATTEMPTS, WEBHOOK_DEFAULT_RETAIN_DAYS, WEBHOOK_DEFAULT_TIMEOUT_MS } from "./ast.ts";
import { SYSTEM_FIELDS } from "./compile-entity.ts";
import { DEFAULT_ALLOWED_MIME_TYPES } from "./compile-runtime.ts";

const REDACTED = "[redacted]";

function redactUrl(value: string | undefined): string | undefined {
  if (!value) {
    return value;
  }
  try {
    const url = new URL(value);
    if (url.password) {
      url.password = REDACTED;
    }
    url.search = "";
    return url.toString();
  } catch {
    return REDACTED;
  }
}

/**
 * The stored copy of the schema (in _bakorin_meta and in backups) never holds
 * secrets: the JWT secrets, bucket keys, database password and alert webhook
 * are replaced, since the running server always reads them from app.yaml and env.
 */
function redactRuntime(runtime: RuntimeAST): RuntimeAST {
  return {
    ...runtime,
    jwtSecret: REDACTED,
    ...(runtime.jwtSecretPrevious ? { jwtSecretPrevious: REDACTED } : {}),
    ...(runtime.postgresUrl ? { postgresUrl: redactUrl(runtime.postgresUrl) } : {}),
    ...(runtime.mysqlUrl ? { mysqlUrl: redactUrl(runtime.mysqlUrl) } : {}),
    files: {
      ...runtime.files,
      ...(runtime.files.accessKey ? { accessKey: REDACTED } : {}),
      ...(runtime.files.secretKey ? { secretKey: REDACTED } : {}),
    },
    ...(runtime.alerts
      ? { alerts: { ...runtime.alerts, ...(runtime.alerts.webhook ? { webhook: redactUrl(runtime.alerts.webhook) } : {}) } }
      : {}),
  };
}

export function serializeAst(ast: SchemaAST): string {
  return JSON.stringify({
    version: ast.version,
    appName: ast.appName,
    appVersion: ast.appVersion,
    appDescription: ast.appDescription,
    branding: ast.branding,
    runtime: redactRuntime(ast.runtime),
    entities: ast.entities,
    order: ast.order,
    auth: ast.auth,
    webhooks: ast.webhooks,
    mail: ast.mail,
  });
}

export function deserializeAst(raw: string): SchemaAST {
  const parsed = JSON.parse(raw) as SchemaAST;
  if (parsed.version !== SCHEMA_AST_VERSION) {
    throw new SchemaError(`unsupported schema AST version ${String(parsed.version)}`);
  }
  parsed.entityMap = Object.fromEntries(parsed.entities.map((entity) => [entity.name, entity]));
  for (const entity of parsed.entities) {
    entity.fieldMap = Object.fromEntries(entity.fields.map((field) => [field.name, field]));
    if (!entity.display) {
      entity.display = "id";
    }
    if (!entity.indexes) {
      entity.indexes = [];
    }
    for (const field of entity.fields) {
      if (!field.writable) {
        field.writable = SYSTEM_FIELDS.has(field.name) ? "none" : "any";
      }
    }
  }
  if (!parsed.auth.requireVerifiedEmail) {
    parsed.auth.requireVerifiedEmail = false;
  }
  if (!parsed.auth.signup) {
    parsed.auth.signup = "invite";
  }
  if (!parsed.runtime.trustProxy) {
    parsed.runtime.trustProxy = { kind: "none" };
  }
  if (!parsed.runtime.apiDocs) {
    parsed.runtime.apiDocs = "admin";
  }
  parsed.runtime.realtime = { ...REALTIME_DEFAULTS, ...(parsed.runtime.realtime ?? {}) };
  parsed.runtime.mcp = { ...MCP_DEFAULTS, ...(parsed.runtime.mcp ?? {}) };
  if (!parsed.runtime.appUrl) {
    parsed.runtime.appUrl = `http://127.0.0.1:${parsed.runtime.port}`;
  }
  if (!parsed.runtime.files.maxBytes) {
    parsed.runtime.files.maxBytes = 10 * 1024 * 1024;
  }
  if (!parsed.runtime.files.allowedMimeTypes || parsed.runtime.files.allowedMimeTypes.length === 0) {
    parsed.runtime.files.allowedMimeTypes = [...DEFAULT_ALLOWED_MIME_TYPES];
  }
  if (!parsed.runtime.files.signedUrlTtlSeconds) {
    parsed.runtime.files.signedUrlTtlSeconds = 900;
  }
  if (!parsed.runtime.webhooksRetainDays) {
    parsed.runtime.webhooksRetainDays = WEBHOOK_DEFAULT_RETAIN_DAYS;
  }
  if (!parsed.runtime.mailRetainDays) {
    parsed.runtime.mailRetainDays = MAIL_DEFAULT_RETAIN_DAYS;
  }
  parsed.mail = parsed.mail ?? [];
  parsed.jobs = parsed.jobs ?? [];
  if (parsed.runtime && parsed.runtime.jobsRetainDays === undefined) {
    parsed.runtime.jobsRetainDays = 30;
  }
  if (parsed.runtime && parsed.runtime.adminIdleTimeoutMinutes === undefined) {
    parsed.runtime.adminIdleTimeoutMinutes = null;
  }
  for (const hook of parsed.webhooks ?? []) {
    hook.maxAttempts = hook.maxAttempts ?? WEBHOOK_DEFAULT_MAX_ATTEMPTS;
    hook.timeoutMs = hook.timeoutMs ?? WEBHOOK_DEFAULT_TIMEOUT_MS;
  }
  return parsed;
}
