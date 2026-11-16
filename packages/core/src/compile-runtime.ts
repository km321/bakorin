/** The runtime section of app.yaml: env overrides, storage, proxies, realtime, MCP, limits. */

import { SchemaError } from "./errors.ts";
import type { AppYaml } from "./yaml-schema.ts";
import { type AlertsRuntimeAST, JOB_DEFAULT_RETAIN_DAYS, MAIL_DEFAULT_RETAIN_DAYS, MCP_DEFAULTS, type McpRuntimeAST, REALTIME_DEFAULTS, type RealtimeRuntimeAST, type RuntimeAST, type TrustProxyAST, WEBHOOK_DEFAULT_RETAIN_DAYS } from "./ast.ts";
import { compileRateLimit } from "./compile-entity.ts";
import { assertStrongJwtSecret, DEV_JWT_SECRET } from "./compile-secrets.ts";

function parseIntervalHours(value: string | undefined): number | null {
  if (!value) {
    return null;
  }
  const match = /^(\d+)(h|d)?$/.exec(value.trim());
  if (!match?.[1]) {
    throw new SchemaError(`invalid backup interval ${JSON.stringify(value)}; use e.g. 24h or 7d`);
  }
  const amount = Number(match[1]);
  const unit = match[2] ?? "h";
  return unit === "d" ? amount * 24 : amount;
}

function firstEnv(env: Record<string, string | undefined>, names: string[]): string | undefined {
  for (const name of names) {
    const value = env[name];
    if (value !== undefined && value !== "") {
      return value;
    }
  }
  return undefined;
}

function joinPosix(base: string, child: string): string {
  if (child.startsWith("/") || /^[A-Za-z]:[\\/]/.test(child)) {
    return child;
  }
  return `${base.replace(/[/\\]+$/, "")}/${child.replace(/^[/\\]+/, "")}`;
}

function parsePort(runtimePort: number | undefined, env: Record<string, string | undefined>): number {
  const raw = firstEnv(env, ["PORT"]) ?? (runtimePort !== undefined ? String(runtimePort) : undefined);
  const port = raw ? Number(raw) : 4371;
  return Number.isFinite(port) && port > 0 ? port : 4371;
}

function parseVirtualHostedStyle(
  files: { virtualHostedStyle?: boolean; pathStyle?: boolean } | undefined,
  env: Record<string, string | undefined>,
): boolean {
  const addressing = (firstEnv(env, ["S3_ADDRESSING_STYLE"]) ?? "").toLowerCase();
  if (addressing === "path") {
    return false;
  }
  if (addressing === "virtual" || addressing === "virtual-hosted" || addressing === "virtualhosted") {
    return true;
  }
  const pathStyle = (firstEnv(env, ["S3_FORCE_PATH_STYLE", "S3_PATH_STYLE"]) ?? "").toLowerCase();
  if (pathStyle === "true" || pathStyle === "1" || pathStyle === "yes") {
    return false;
  }
  if (pathStyle === "false" || pathStyle === "0" || pathStyle === "no") {
    return true;
  }
  const virtual = (firstEnv(env, ["S3_VIRTUAL_HOSTED_STYLE"]) ?? "").toLowerCase();
  if (virtual === "true" || virtual === "1" || virtual === "yes") {
    return true;
  }
  if (virtual === "false" || virtual === "0" || virtual === "no") {
    return false;
  }
  if (files?.pathStyle === true) {
    return false;
  }
  if (files?.virtualHostedStyle === true) {
    return true;
  }
  return false;
}

export function compileRuntime(yaml: AppYaml, production: boolean, env: Record<string, string | undefined>): RuntimeAST {
  const runtime = yaml.runtime ?? {};
  const dialect = runtime.dialect ?? (runtime.postgres?.url ? "postgres" : "sqlite");
  const jwtSecret = runtime.jwt?.secret || env.JWT_SECRET || (production ? "" : DEV_JWT_SECRET);
  const jwtSecretPrevious = firstEnv(env, ["JWT_SECRET_PREVIOUS"]);
  if (production) {
    assertStrongJwtSecret(jwtSecret);
    if (jwtSecretPrevious) {
      assertStrongJwtSecret(jwtSecretPrevious, "JWT_SECRET_PREVIOUS");
    }
  }
  if (dialect === "postgres" && !runtime.postgres?.url) {
    throw new SchemaError("runtime.postgres.url is required when dialect is postgres");
  }
  const dataDir = firstEnv(env, ["BAKORIN_DATA_DIR"]);
  const bucket = runtime.files?.bucket ?? firstEnv(env, ["S3_BUCKET", "BUCKET"]);
  const endpoint = runtime.files?.endpoint ?? firstEnv(env, ["S3_ENDPOINT", "AWS_ENDPOINT_URL", "AWS_ENDPOINT"]);
  const accessKey = runtime.files?.accessKey ?? firstEnv(env, ["S3_ACCESS_KEY", "AWS_ACCESS_KEY_ID"]);
  const secretKey = runtime.files?.secretKey ?? firstEnv(env, ["S3_SECRET_KEY", "AWS_SECRET_ACCESS_KEY"]);
  const region = runtime.files?.region ?? firstEnv(env, ["S3_REGION", "AWS_DEFAULT_REGION", "AWS_REGION"]) ?? "auto";
  const filesDriverEnv = firstEnv(env, ["FILES_DRIVER", "BAKORIN_FILES_DRIVER"]);
  const driver =
    filesDriverEnv === "local" || filesDriverEnv === "s3"
      ? filesDriverEnv
      : bucket
        ? "s3"
        : (runtime.files?.driver ?? "local");
  const yamlSqlite = runtime.sqlite?.path ?? "./data/app.db";
  const sqliteFile = yamlSqlite.split(/[/\\]/).pop() ?? "app.db";
  const sqlitePath = dataDir ? joinPosix(dataDir, sqliteFile) : yamlSqlite;
  const yamlFilesPath = runtime.files?.path ?? "./data/uploads";
  const filesPath = driver === "local" && dataDir ? joinPosix(dataDir, "uploads") : yamlFilesPath;
  const yamlDest = runtime.backups?.destination;
  const backupPrefix = firstEnv(env, ["BAKORIN_BACKUP_PREFIX"]) ?? "backups";
  const destination =
    firstEnv(env, ["BAKORIN_BACKUP_DESTINATION"]) ??
    (yamlDest?.startsWith("s3://") ? yamlDest : undefined) ??
    (bucket ? `s3://${bucket}/${backupPrefix}` : undefined) ??
    (dataDir ? joinPosix(dataDir, "backups") : undefined) ??
    yamlDest ??
    "./data/backups";
  return {
    dialect,
    host: runtime.host ?? "0.0.0.0",
    port: parsePort(runtime.port, env),
    sqlitePath,
    postgresUrl: runtime.postgres?.url,
    jwtSecret,
    jwtSecretPrevious,
    accessTtlSeconds: runtime.jwt?.accessTtlSeconds ?? 900,
    refreshTtlSeconds: runtime.jwt?.refreshTtlSeconds ?? 60 * 60 * 24 * 30,
    files: {
      driver,
      path: filesPath,
      bucket,
      endpoint,
      accessKey,
      secretKey,
      region,
      virtualHostedStyle: parseVirtualHostedStyle(runtime.files, env),
      maxBytes: runtime.files?.maxBytes ?? 10 * 1024 * 1024,
      allowedMimeTypes: parseAllowedMime(runtime.files?.allowedMimeTypes),
      signedUrlTtlSeconds: runtime.files?.signedUrlTtlSeconds ?? 900,
      ...(runtime.files?.rateLimit ? { rateLimit: compileRateLimit(runtime.files.rateLimit) } : {}),
    },
    backups: {
      intervalHours: parseIntervalHours(runtime.backups?.interval),
      cron: runtime.backups?.cron,
      retain: runtime.backups?.retain ?? 14,
      destination,
    },
    corsOrigins: parseCorsOrigins(runtime.cors?.origins, env),
    hooksPath: runtime.hooks,
    apiDocs: parseApiDocs(runtime.apiDocs, env, production),
    appUrl: parseAppUrl(env, parsePort(runtime.port, env)),
    webhooksRetainDays: parseWebhookRetainDays(runtime.webhooks?.retainDays, env),
    mailRetainDays: parseMailRetainDays(runtime.mail?.retainDays, env),
    jobsRetainDays: parseJobsRetainDays(runtime.jobs?.retainDays, env),
    alerts: parseAlerts(runtime.alerts, env),
    trustProxy: parseTrustProxy(runtime.trustProxy, env),
    realtime: parseRealtime(runtime.realtime, env, dialect),
    mcp: parseMcp(runtime.mcp, env),
  };
}

type RawRealtimeRuntime = NonNullable<NonNullable<AppYaml["runtime"]>["realtime"]>;

function envInt(env: Record<string, string | undefined>, name: string, min: number, max: number): number | undefined {
  const raw = (env[name] ?? "").trim();
  if (!raw) {
    return undefined;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new SchemaError(`${name} must be a whole number from ${min} to ${max}`);
  }
  return value;
}

/** runtime.realtime, with BAKORIN_REALTIME_* env overrides. */
function parseRealtime(
  raw: RawRealtimeRuntime | undefined,
  env: Record<string, string | undefined>,
  dialect: string,
): RealtimeRuntimeAST {
  const brokerEnv = (env.BAKORIN_REALTIME_BROKER ?? "").trim().toLowerCase();
  if (brokerEnv && brokerEnv !== "auto" && brokerEnv !== "memory" && brokerEnv !== "postgres") {
    throw new SchemaError(`BAKORIN_REALTIME_BROKER must be auto, memory, or postgres, not ${JSON.stringify(env.BAKORIN_REALTIME_BROKER)}`);
  }
  const broker = (brokerEnv || raw?.broker || REALTIME_DEFAULTS.broker) as RealtimeRuntimeAST["broker"];
  if (broker === "postgres" && dialect !== "postgres") {
    throw new SchemaError("runtime.realtime.broker postgres needs runtime.dialect postgres");
  }
  return {
    broker,
    maxConnections:
      envInt(env, "BAKORIN_REALTIME_MAX_CONNECTIONS", 1, 1_000_000) ?? raw?.maxConnections ?? REALTIME_DEFAULTS.maxConnections,
    maxPerUser: envInt(env, "BAKORIN_REALTIME_MAX_PER_USER", 1, 10_000) ?? raw?.maxPerUser ?? REALTIME_DEFAULTS.maxPerUser,
    heartbeatSeconds: raw?.heartbeatSeconds ?? REALTIME_DEFAULTS.heartbeatSeconds,
    replayEvents: raw?.replayEvents ?? REALTIME_DEFAULTS.replayEvents,
    retainMinutes: raw?.retainMinutes ?? REALTIME_DEFAULTS.retainMinutes,
    maxBufferKb: raw?.maxBufferKb ?? REALTIME_DEFAULTS.maxBufferKb,
  };
}

/** runtime.mcp (true, or { enabled, sampleLimit }). BAKORIN_MCP=true or false wins. */
function parseMcp(raw: NonNullable<AppYaml["runtime"]>["mcp"], env: Record<string, string | undefined>): McpRuntimeAST {
  const fromYaml = typeof raw === "boolean" ? { enabled: raw } : (raw ?? {});
  const flag = (env.BAKORIN_MCP ?? "").trim().toLowerCase();
  let enabled = fromYaml.enabled ?? MCP_DEFAULTS.enabled;
  if (flag === "true" || flag === "1") {
    enabled = true;
  } else if (flag === "false" || flag === "0") {
    enabled = false;
  } else if (flag) {
    throw new SchemaError(`BAKORIN_MCP must be true or false, not ${JSON.stringify(env.BAKORIN_MCP)}`);
  }
  return { enabled, sampleLimit: fromYaml.sampleLimit ?? MCP_DEFAULTS.sampleLimit };
}

export function parseTrustProxy(
  yaml: boolean | number | string[] | undefined,
  env: Record<string, string | undefined>,
): TrustProxyAST {
  const raw = (env.TRUST_PROXY ?? "").trim();
  let value: boolean | number | string[] | undefined = yaml;
  if (raw) {
    const lower = raw.toLowerCase();
    if (lower === "false" || lower === "no" || lower === "off") {
      value = false;
    } else if (lower === "true" || lower === "yes" || lower === "on") {
      value = true;
    } else if (/^\d+$/.test(raw)) {
      value = Number(raw);
    } else {
      value = raw.split(",").map((item) => item.trim()).filter(Boolean);
    }
  }
  if (value === undefined || value === false || value === 0) {
    return { kind: "none" };
  }
  if (value === true) {
    return { kind: "hops", hops: 1 };
  }
  if (typeof value === "number") {
    if (!Number.isInteger(value) || value < 0 || value > 10) {
      throw new SchemaError("runtime.trustProxy hop count must be a whole number from 0 to 10");
    }
    return { kind: "hops", hops: value };
  }
  for (const cidr of value) {
    if (!isCidr(cidr)) {
      throw new SchemaError(`runtime.trustProxy: ${cidr} is not an IP address or CIDR range`);
    }
  }
  return { kind: "cidrs", cidrs: value };
}

function isCidr(value: string): boolean {
  const [address, bits, extra] = value.split("/");
  if (extra !== undefined || !address) {
    return false;
  }
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(address);
  if (v4) {
    if (v4.slice(1).some((part) => Number(part) > 255)) {
      return false;
    }
    return bits === undefined || (/^\d+$/.test(bits) && Number(bits) <= 32);
  }
  if (address.includes(":") && /^[0-9a-fA-F:.]+$/.test(address)) {
    return bits === undefined || (/^\d+$/.test(bits) && Number(bits) <= 128);
  }
  return false;
}

function parseAlerts(
  yaml: { email?: string | string[]; webhook?: string; backupMaxAgeHours?: number; checkIntervalMinutes?: number } | undefined,
  env: Record<string, string | undefined>,
): AlertsRuntimeAST {
  const emailSource = yaml?.email ?? env.BAKORIN_ALERT_EMAIL;
  const email = (Array.isArray(emailSource) ? emailSource : (emailSource ?? "").split(","))
    .map((value) => value.trim())
    .filter(Boolean);
  for (const address of email) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      throw new SchemaError(`runtime.alerts.email: ${address} is not an email address`);
    }
  }
  const webhook = (yaml?.webhook ?? env.BAKORIN_ALERT_WEBHOOK ?? "").trim() || undefined;
  if (webhook && !/^https?:\/\//.test(webhook)) {
    throw new SchemaError("runtime.alerts.webhook must be an http(s) URL");
  }
  const envMaxAge = env.BAKORIN_ALERT_BACKUP_MAX_AGE_HOURS ? Number(env.BAKORIN_ALERT_BACKUP_MAX_AGE_HOURS) : undefined;
  const maxAge = yaml?.backupMaxAgeHours ?? (envMaxAge && Number.isFinite(envMaxAge) && envMaxAge > 0 ? envMaxAge : undefined);
  return {
    email,
    ...(webhook ? { webhook } : {}),
    backupMaxAgeHours: maxAge ?? null,
    checkIntervalMinutes: yaml?.checkIntervalMinutes ?? 15,
  };
}

function parseWebhookRetainDays(
  yamlValue: number | undefined,
  env: Record<string, string | undefined>,
): number {
  const fromEnv = firstEnv(env, ["BAKORIN_WEBHOOK_RETAIN_DAYS"]);
  const value = fromEnv ? Number(fromEnv) : (yamlValue ?? WEBHOOK_DEFAULT_RETAIN_DAYS);
  if (!Number.isInteger(value) || value < 1 || value > 3650) {
    throw new SchemaError("runtime.webhooks.retainDays must be an integer from 1 to 3650");
  }
  return value;
}

function parseMailRetainDays(yamlValue: number | undefined, env: Record<string, string | undefined>): number {
  const fromEnv = firstEnv(env, ["BAKORIN_MAIL_RETAIN_DAYS"]);
  const value = fromEnv ? Number(fromEnv) : (yamlValue ?? MAIL_DEFAULT_RETAIN_DAYS);
  if (!Number.isInteger(value) || value < 1 || value > 3650) {
    throw new SchemaError("runtime.mail.retainDays must be an integer from 1 to 3650");
  }
  return value;
}

function parseJobsRetainDays(yamlValue: number | undefined, env: Record<string, string | undefined>): number {
  const fromEnv = firstEnv(env, ["BAKORIN_JOBS_RETAIN_DAYS"]);
  const value = fromEnv ? Number(fromEnv) : (yamlValue ?? JOB_DEFAULT_RETAIN_DAYS);
  if (!Number.isInteger(value) || value < 1 || value > 3650) {
    throw new SchemaError("runtime.jobs.retainDays must be an integer from 1 to 3650");
  }
  return value;
}

function parseCorsOrigins(
  yamlOrigins: string[] | undefined,
  env: Record<string, string | undefined>,
): string[] {
  const fromEnv = firstEnv(env, ["CORS_ORIGINS"]);
  if (fromEnv !== undefined) {
    const list = fromEnv.split(",").map((item) => item.trim()).filter(Boolean);
    if (list.length === 0) {
      throw new SchemaError("CORS_ORIGINS is empty");
    }
    return list;
  }
  return yamlOrigins ?? ["*"];
}

function parseAppUrl(env: Record<string, string | undefined>, port: number): string {
  const raw = firstEnv(env, ["APP_URL", "BAKORIN_APP_URL"]) ?? `http://127.0.0.1:${port}`;
  return raw.replace(/\/+$/, "");
}

export const DEFAULT_ALLOWED_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "application/pdf",
  "text/plain",
];

function parseAllowedMime(raw: string[] | undefined): string[] {
  if (!raw || raw.length === 0) {
    return [...DEFAULT_ALLOWED_MIME_TYPES];
  }
  if (raw.includes("*")) {
    return ["*"];
  }
  return raw;
}

/** BAKORIN_API_DOCS wins over runtime.apiDocs. Production defaults to admin only. */
function parseApiDocs(
  value: "public" | "admin" | undefined,
  env: Record<string, string | undefined>,
  production: boolean,
): "public" | "admin" {
  const fromEnv = (env.BAKORIN_API_DOCS ?? "").trim().toLowerCase();
  if (fromEnv === "public" || fromEnv === "admin") {
    return fromEnv;
  }
  if (fromEnv) {
    throw new SchemaError(`BAKORIN_API_DOCS must be public or admin, not ${JSON.stringify(env.BAKORIN_API_DOCS)}`);
  }
  return value ?? (production ? "admin" : "public");
}
