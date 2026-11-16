import { parse as parseYaml } from "yaml";
import { SchemaError } from "./errors.ts";
import { compileBranding } from "./branding.ts";
import { assertIdent } from "./ident.ts";
import { interpolateEnv } from "./interpolate.ts";
import { parsePolicies } from "./policies.ts";
import { topologicalOrder } from "./topo.ts";
import { formatZodError } from "./format-schema.ts";
import { appYamlSchema, RATE_WINDOW_PATTERN, type AppYaml, type RawField } from "./yaml-schema.ts";
import {
  MAIL_DEFAULT_MAX_ATTEMPTS,
  MAIL_DEFAULT_RETAIN_DAYS,
  SCHEMA_AST_VERSION,
  WEBHOOK_DEFAULT_MAX_ATTEMPTS,
  WEBHOOK_DEFAULT_RETAIN_DAYS,
  WEBHOOK_DEFAULT_TIMEOUT_MS,
  type ActionName,
  type AuthAST,
  type SignupMode,
  type TrustProxyAST,
  type EntityAST,
  type FieldAST,
  type FieldTypeName,
  type FieldWritable,
  type MailConditionAST,
  type MailRuleAST,
  type PolicyAST,
  type RateLimitAST,
  type AlertsRuntimeAST,
  type RuntimeAST,
  type SchemaAST,
} from "./ast.ts";

const SYSTEM_FIELDS = new Set(["id", "createdAt", "updatedAt"]);

function asFieldObject(value: AppYaml["entities"][string]["fields"][string]): RawField {
  if (typeof value === "string") {
    return { type: value };
  }
  return value;
}

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

function compileField(entityName: string, name: string, raw: RawField): FieldAST {
  assertIdent(name, "field");
  if (SYSTEM_FIELDS.has(name)) {
    throw new SchemaError(`${entityName}.${name} is a reserved system field`);
  }
  const type = raw.type as FieldTypeName;
  if (type === "enum" && (!raw.values || raw.values.length === 0)) {
    throw new SchemaError(`${entityName}.${name} is an enum and needs a values list`);
  }
  if (type === "relation" && !raw.to) {
    throw new SchemaError(`${entityName}.${name} is a relation and needs to: <entity>`);
  }
  if (raw.to && type !== "relation") {
    throw new SchemaError(`${entityName}.${name} has to: but is not a relation`);
  }
  if (raw.values && type !== "enum") {
    throw new SchemaError(`${entityName}.${name} has values: but is not an enum`);
  }
  for (const value of raw.values ?? []) {
    assertIdent(value, "enum");
  }
  return {
    name,
    type,
    required: raw.required === true || raw.default !== undefined ? raw.required !== false : false,
    unique: raw.unique === true,
    indexed: raw.index === true || raw.unique === true || type === "relation",
    defaultValue: raw.default,
    enumValues: raw.values,
    relation: raw.to
      ? {
          to: raw.to,
          onDelete: raw.onDelete ?? "restrict",
        }
      : undefined,
    renameFrom: raw.renameFrom,
    secret: raw.secret === true || type === "password",
    description: raw.description,
    writable: compileWritable(entityName, name, raw),
    ...(raw.private !== undefined ? { private: raw.private } : {}),
  };
}

function compileWritable(entityName: string, name: string, raw: RawField): FieldWritable {
  const flags = [raw.writable, raw.readonly === true ? "none" : undefined, raw.adminOnly === true ? "admin" : undefined].filter(
    (value): value is "admin" | "none" => value === "admin" || value === "none",
  );
  const unique = [...new Set(flags)];
  if (unique.length > 1) {
    throw new SchemaError(`${entityName}.${name} has conflicting writable/readonly/adminOnly flags`);
  }
  return unique[0] ?? "any";
}

function systemFields(): FieldAST[] {
  return [
    {
      name: "id",
      type: "text",
      required: true,
      unique: true,
      indexed: true,
      defaultValue: undefined,
      secret: false,
      writable: "none",
    },
    {
      name: "createdAt",
      type: "datetime",
      required: true,
      unique: false,
      indexed: true,
      defaultValue: undefined,
      secret: false,
      writable: "none",
    },
    {
      name: "updatedAt",
      type: "datetime",
      required: true,
      unique: false,
      indexed: true,
      defaultValue: undefined,
      secret: false,
      writable: "none",
    },
  ];
}

function defaultPolicies(auth: boolean): Record<ActionName, PolicyAST[]> {
  if (auth) {
    return {
      read: [{ kind: "owner", field: "id" }, { kind: "admin" }],
      create: [{ kind: "admin" }],
      update: [{ kind: "owner", field: "id" }],
      delete: [{ kind: "admin" }],
    };
  }
  return {
    read: [{ kind: "authenticated" }],
    create: [{ kind: "authenticated" }],
    update: [{ kind: "authenticated" }],
    delete: [{ kind: "authenticated" }],
  };
}

function resolveDisplay(entityName: string, fields: FieldAST[], requested: string | undefined): string {
  if (requested) {
    const field = fields.find((item) => item.name === requested);
    if (!field) {
      throw new SchemaError(`${entityName} display field ${requested} does not exist`);
    }
    if (field.secret) {
      throw new SchemaError(`${entityName} display field ${requested} cannot be secret`);
    }
    return requested;
  }
  for (const name of ["name", "title", "email", "company"]) {
    const field = fields.find((item) => item.name === name && !item.secret);
    if (field) {
      return name;
    }
  }
  return "id";
}

function titleCase(name: string): string {
  return name
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function pluralize(name: string): string {
  if (name.endsWith("s")) {
    return name;
  }
  if (name.endsWith("y") && name.length > 1 && !/[aeiou]y$/i.test(name)) {
    return `${name.slice(0, -1)}ies`;
  }
  return `${name}s`;
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

export const DEV_JWT_SECRET = "dev-only-change-me";
export const MIN_JWT_SECRET_LENGTH = 32;

const PLACEHOLDER_SECRET = /change[-_ ]?me|replace[-_ ]?me|your[-_ ]?secret|dev[-_ ]?only|example|placeholder/i;

/**
 * Explicit development or test mode: `bakorin dev` sets BAKORIN_ENV=development,
 * and the test preload sets BAKORIN_TEST=1. Everything else is production, so a
 * server started any other way never runs on the public dev secret.
 */
export function isDevMode(env: Record<string, string | undefined>): boolean {
  const mode = (env.BAKORIN_ENV ?? "").trim().toLowerCase();
  if (mode === "production") {
    return false;
  }
  return mode === "development" || mode === "dev" || mode === "test" || env.BAKORIN_TEST === "1";
}

/** Why a JWT secret is too weak for production, or null when it is fine. */
export function weakJwtSecretReason(secret: string | undefined): string | null {
  if (!secret) {
    return "it is not set";
  }
  if (secret === DEV_JWT_SECRET || PLACEHOLDER_SECRET.test(secret)) {
    return "it is a placeholder value";
  }
  if (secret.length < MIN_JWT_SECRET_LENGTH) {
    return `it is ${secret.length} characters; use at least ${MIN_JWT_SECRET_LENGTH}`;
  }
  if (new Set(secret).size < 10) {
    return "it repeats too few characters to be random";
  }
  return null;
}

export function assertStrongJwtSecret(secret: string | undefined, name = "JWT_SECRET"): void {
  const reason = weakJwtSecretReason(secret);
  if (reason) {
    throw new SchemaError(
      `${name} is too weak for production: ${reason}. Generate one with: openssl rand -base64 48. ` +
        "Only `bakorin dev` (BAKORIN_ENV=development) runs without a strong secret.",
    );
  }
}

function compileRuntime(yaml: AppYaml, production: boolean, env: Record<string, string | undefined>): RuntimeAST {
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
    appUrl: parseAppUrl(env, parsePort(runtime.port, env)),
    webhooksRetainDays: parseWebhookRetainDays(runtime.webhooks?.retainDays, env),
    mailRetainDays: parseMailRetainDays(runtime.mail?.retainDays, env),
    alerts: parseAlerts(runtime.alerts, env),
    trustProxy: parseTrustProxy(runtime.trustProxy, env),
  };
}

/**
 * runtime.trustProxy (or TRUST_PROXY): false or 0 for none, a hop count such as 1,
 * true for one hop, or a list of proxy CIDRs. The env var wins so a host can set it.
 */
/** API prefixes Bakorin mounts under /api/v1. An entity with one of these names would be shadowed. */
export const RESERVED_ENTITY_NAMES = ["auth", "audit", "backups", "docs", "files", "mail", "status", "webhooks", "_meta"] as const;

function assertEntityRouteFree(name: string): void {
  if ((RESERVED_ENTITY_NAMES as readonly string[]).includes(name.toLowerCase())) {
    throw new SchemaError(
      `entity name "${name}" is reserved because /api/v1/${name.toLowerCase()} is a built in route. Rename the entity, for example to "${name}_items" or a more specific name.`,
    );
  }
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

const MAIL_TEMPLATE_TOKEN = /\{\{\{?\s*([^}]*?)\s*\}?\}\}/g;
const MAIL_ROOTS = new Set(["record", "before", "expand", "event", "app"]);

function listOf(value: string | string[] | undefined): string[] {
  if (value === undefined) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function checkMailPlaceholders(label: string, value: string, expand: string[], entity: EntityAST): void {
  for (const match of value.matchAll(MAIL_TEMPLATE_TOKEN)) {
    const path = (match[1] ?? "").trim();
    if (match[0].startsWith("{{{")) {
      throw new SchemaError(`${label}: raw {{{ }}} output is not allowed here, use {{ ${path} }}`);
    }
    if (path.startsWith("#") || path.startsWith("/") || path === "else") {
      throw new SchemaError(`${label}: blocks like {{#if}} are only allowed in template files`);
    }
    const parts = path.split(".");
    const root = parts[0] ?? "";
    if (!MAIL_ROOTS.has(root)) {
      throw new SchemaError(
        `${label}: {{ ${path} }} must start with record, before, expand, event, or app`,
      );
    }
    if ((root === "record" || root === "before") && parts[1] && !entity.fieldMap[parts[1]]) {
      throw new SchemaError(`${label}: {{ ${path} }} references unknown field ${entity.name}.${parts[1]}`);
    }
    if (root === "expand" && parts[1] && !expand.includes(parts[1])) {
      throw new SchemaError(`${label}: {{ ${path} }} needs "${parts[1]}" in the rule's expand list`);
    }
  }
}

function compileMailRules(yaml: AppYaml, entityMap: Record<string, EntityAST>): MailRuleAST[] {
  const seen = new Set<string>();
  return (yaml.mail ?? []).map((rule, index) => {
    const id = rule.name ?? `mail_${index + 1}`;
    const label = `mail rule ${rule.name ? `"${rule.name}"` : `#${index + 1}`}`;
    if (seen.has(id)) {
      throw new SchemaError(`${label}: name ${id} is used by more than one mail rule`);
    }
    seen.add(id);
    const entity = entityMap[rule.entity];
    if (!entity) {
      const known = Object.keys(entityMap).join(", ");
      throw new SchemaError(`${label}: entity ${rule.entity} does not exist (known entities: ${known})`);
    }
    const expand = rule.expand ?? [];
    for (const name of expand) {
      const field = entity.fieldMap[name];
      if (!field) {
        throw new SchemaError(`${label}: expand field ${entity.name}.${name} does not exist`);
      }
      if (!field.relation) {
        throw new SchemaError(`${label}: expand field ${entity.name}.${name} must be a relation field`);
      }
    }
    const changed = rule.changed ?? [];
    for (const name of changed) {
      if (!entity.fieldMap[name]) {
        throw new SchemaError(`${label}: changed field ${entity.name}.${name} does not exist`);
      }
    }
    if (changed.length > 0 && (rule.events.length !== 1 || rule.events[0] !== "update")) {
      throw new SchemaError(`${label}: changed only works with events: [update]`);
    }
    const when: MailConditionAST[] = [];
    for (const [field, condition] of Object.entries(rule.when ?? {})) {
      const target = entity.fieldMap[field];
      if (!target) {
        throw new SchemaError(`${label}: when field ${entity.name}.${field} does not exist`);
      }
      if (target.secret || target.type === "password") {
        throw new SchemaError(`${label}: when cannot test secret field ${entity.name}.${field}`);
      }
      if (condition === null || typeof condition !== "object") {
        when.push({ field, op: "equals", value: condition });
        continue;
      }
      const ops = Object.keys(condition);
      if (ops.length !== 1) {
        throw new SchemaError(`${label}: when.${field} must use exactly one of equals, not, in, notIn, or exists`);
      }
      if (condition.in) {
        when.push({ field, op: "in", values: condition.in });
      } else if (condition.notIn) {
        when.push({ field, op: "notIn", values: condition.notIn });
      } else if (condition.exists !== undefined) {
        when.push({ field, op: "exists", exists: condition.exists });
      } else if ("not" in condition) {
        when.push({ field, op: "not", value: condition.not ?? null });
      } else {
        when.push({ field, op: "equals", value: condition.equals ?? null });
      }
    }
    const to = listOf(rule.to);
    const cc = listOf(rule.cc);
    const bcc = listOf(rule.bcc);
    for (const [key, values] of [["to", to], ["cc", cc], ["bcc", bcc]] as const) {
      for (const value of values) {
        checkMailPlaceholders(`${label} ${key}`, value, expand, entity);
      }
    }
    if (rule.replyTo) {
      checkMailPlaceholders(`${label} replyTo`, rule.replyTo, expand, entity);
    }
    if (rule.subject) {
      checkMailPlaceholders(`${label} subject`, rule.subject, expand, entity);
    }
    return {
      id,
      entity: entity.name,
      events: rule.events,
      to,
      cc,
      bcc,
      replyTo: rule.replyTo,
      subject: rule.subject,
      template: rule.template,
      when,
      changed,
      expand,
      maxAttempts: rule.maxAttempts ?? MAIL_DEFAULT_MAX_ATTEMPTS,
    };
  });
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

function compileIndexes(entityName: string, fieldMap: Record<string, { name: string }>, raw: Array<string | string[]> | undefined): string[][] {
  if (!raw) {
    return [];
  }
  return raw.map((item) => {
    const fields = Array.isArray(item) ? item : [item];
    for (const field of fields) {
      if (!fieldMap[field]) {
        throw new SchemaError(`${entityName} index references missing field ${field}`);
      }
    }
    return fields;
  });
}

function findAuthEntity(yaml: AppYaml, entities: EntityAST[]): AuthAST {
  const marked = entities.filter((entity) => entity.auth);
  const configured = yaml.auth?.entity;
  let entity: EntityAST | undefined;
  if (configured) {
    entity = entities.find((item) => item.name === configured);
    if (!entity) {
      throw new SchemaError(`auth.entity ${configured} does not exist`);
    }
  } else if (marked.length === 1) {
    entity = marked[0];
  } else if (marked.length > 1) {
    throw new SchemaError("multiple entities have auth: true; set auth.entity explicitly");
  } else {
    entity = entities.find((item) => item.name === "users");
  }
  if (!entity) {
    throw new SchemaError("an auth entity is required; mark one entity with auth: true");
  }
  entity.auth = true;
  const identityField = yaml.auth?.identity ?? "email";
  const passwordField = yaml.auth?.password ?? "password";
  const roleField = yaml.auth?.role ?? "role";
  if (!entity.fieldMap[identityField]) {
    throw new SchemaError(`auth identity field ${entity.name}.${identityField} is missing`);
  }
  if (!entity.fieldMap[passwordField] || entity.fieldMap[passwordField]?.type !== "password") {
    throw new SchemaError(`auth password field ${entity.name}.${passwordField} must have type password`);
  }
  if (!entity.fieldMap[roleField] || entity.fieldMap[roleField]?.type !== "enum") {
    throw new SchemaError(`auth role field ${entity.name}.${roleField} must be an enum`);
  }
  const adminRole = yaml.auth?.adminRole ?? "admin";
  if (!entity.fieldMap[roleField]?.enumValues?.includes(adminRole)) {
    throw new SchemaError(`auth adminRole ${adminRole} is not in ${entity.name}.${roleField} values`);
  }
  entity.fieldMap[identityField]!.unique = true;
  entity.fieldMap[identityField]!.required = true;
  entity.fieldMap[passwordField]!.required = true;
  entity.fieldMap[passwordField]!.secret = true;
  entity.fieldMap[roleField]!.writable = "admin";
  ensureEmailVerifiedField(entity);
  markPrivateAuthFields(entity, [identityField, roleField, "emailVerified"]);
  return {
    entity: entity.name,
    identityField,
    passwordField,
    roleField,
    adminRole,
    requireVerifiedEmail: yaml.auth?.requireVerifiedEmail === true,
    signup: compileSignup(yaml, entity),
  };
}

/**
 * auth.signup decides who may create an account at POST /api/v1/auth/signup.
 * When it is not set, it follows the auth entity's create policy: a public create
 * means the app already allows public signup (open); anything else is invite. An
 * explicit invite or closed cannot sit next to a public create policy, because
 * that would reopen signup through POST /api/v1/<users>.
 */
function compileSignup(yaml: AppYaml, entity: EntityAST): SignupMode {
  const publicCreate = entity.policies.create.some((policy) => policy.kind === "public");
  const mode: SignupMode = yaml.auth?.signup ?? (publicCreate ? "open" : "invite");
  if (mode !== "open" && publicCreate) {
    throw new SchemaError(
      `${entity.name}.policies.create is public, which lets anyone sign up through POST /api/v1/${entity.name}, but auth.signup is ${mode}. ` +
        "Set auth.signup: open to allow public signup, and use admin for the create policy.",
    );
  }
  return mode;
}

/** Fields only the user themself and admins see by default on the auth entity. */
function markPrivateAuthFields(entity: EntityAST, names: string[]): void {
  for (const name of names) {
    const field = entity.fieldMap[name];
    if (field && field.private === undefined) {
      field.private = true;
    }
  }
}

function ensureEmailVerifiedField(entity: EntityAST): void {
  const existing = entity.fieldMap.emailVerified;
  if (existing) {
    if (existing.type !== "boolean") {
      throw new SchemaError(`${entity.name}.emailVerified must be boolean`);
    }
    if (existing.writable === "any") {
      existing.writable = "admin";
    }
    return;
  }
  const field: FieldAST = {
    name: "emailVerified",
    type: "boolean",
    required: false,
    unique: false,
    indexed: false,
    defaultValue: false,
    secret: false,
    writable: "admin",
    description: "True after the user confirms their email, or when an admin marks them verified.",
  };
  entity.fields.push(field);
  entity.fieldMap.emailVerified = field;
}

export interface CompileOptions {
  env?: Record<string, string | undefined>;
  production?: boolean;
}

export function compileAppYaml(source: string, options: CompileOptions = {}): SchemaAST {
  const env = options.env ?? process.env;
  const interpolated = interpolateEnv(source, env);
  let parsed: unknown;
  try {
    parsed = parseYaml(interpolated);
  } catch (error) {
    throw new SchemaError(`app.yaml is not valid YAML: ${error instanceof Error ? error.message : String(error)}`);
  }
  const parsedYaml = appYamlSchema.safeParse(parsed, { reportInput: true });
  if (!parsedYaml.success) {
    throw new SchemaError(formatZodError(parsedYaml.error));
  }
  const yaml = parsedYaml.data;
  const production = options.production ?? !isDevMode(env);
  const runtime = compileRuntime(yaml, production, env);

  const entities: EntityAST[] = Object.entries(yaml.entities).map(([name, raw]) => {
    assertIdent(name, "entity");
    assertEntityRouteFree(name);
    const compiledFields = Object.entries(raw.fields).map(([fieldName, fieldRaw]) =>
      compileField(name, fieldName, asFieldObject(fieldRaw)),
    );
    const fields = [...systemFields(), ...compiledFields];
    const fieldMap = Object.fromEntries(fields.map((field) => [field.name, field]));
    const fallback = defaultPolicies(raw.auth === true || name === yaml.auth?.entity);
    const policies: Record<ActionName, PolicyAST[]> = {
      read: parsePolicies(raw.policies?.read, fallback.read, `entities.${name}.policies.read`),
      create: parsePolicies(raw.policies?.create, fallback.create, `entities.${name}.policies.create`),
      update: parsePolicies(raw.policies?.update, fallback.update, `entities.${name}.policies.update`),
      delete: parsePolicies(raw.policies?.delete, fallback.delete, `entities.${name}.policies.delete`),
    };
    for (const action of ["read", "create", "update", "delete"] as const) {
      for (const policy of policies[action]) {
        if (policy.kind === "owner" && !fieldMap[policy.field]) {
          throw new SchemaError(`${name} policy ${action}: owner(${policy.field}) references a missing field`);
        }
      }
    }
    return {
      name,
      label: raw.label ?? titleCase(name.replace(/s$/, "") || name),
      plural: raw.plural ?? titleCase(pluralize(name)),
      display: resolveDisplay(name, fields, raw.display),
      description: raw.description,
      auth: raw.auth === true,
      fields,
      fieldMap,
      policies,
      indexes: compileIndexes(name, fieldMap, raw.indexes),
      deprecated: false,
      ...(raw.renameFrom ? { renameFrom: raw.renameFrom } : {}),
      ...(raw.rateLimit ? { rateLimit: compileEntityRateLimit(raw.rateLimit) } : {}),
    };
  });

  const entityMap = Object.fromEntries(entities.map((entity) => [entity.name, entity]));
  for (const entity of entities) {
    for (const field of entity.fields) {
      if (field.relation && !entityMap[field.relation.to]) {
        throw new SchemaError(`${entity.name}.${field.name} relates to unknown entity ${field.relation.to}`);
      }
    }
  }

  const auth = findAuthEntity(yaml, entities);
  const order = topologicalOrder(entities);

  const webhooks = (yaml.webhooks ?? []).map((hook, index) => {
    if (hook.entity !== "*" && !entityMap[hook.entity]) {
      throw new SchemaError(`webhook entity ${hook.entity} does not exist`);
    }
    return {
      id: `wh_${index + 1}`,
      entity: hook.entity,
      events: hook.events,
      url: hook.url,
      secret: hook.secret,
      maxAttempts: hook.maxAttempts ?? WEBHOOK_DEFAULT_MAX_ATTEMPTS,
      timeoutMs: hook.timeoutMs ?? WEBHOOK_DEFAULT_TIMEOUT_MS,
    };
  });

  const mail = compileMailRules(yaml, entityMap);

  return {
    version: SCHEMA_AST_VERSION,
    appName: yaml.app.name,
    appVersion: yaml.app.version ?? "0.1.0",
    appDescription: yaml.app.description,
    ...(yaml.branding ? { branding: compileBranding(yaml.branding) } : {}),
    runtime,
    entities,
    entityMap,
    order,
    auth,
    webhooks,
    mail,
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
  for (const hook of parsed.webhooks ?? []) {
    hook.maxAttempts = hook.maxAttempts ?? WEBHOOK_DEFAULT_MAX_ATTEMPTS;
    hook.timeoutMs = hook.timeoutMs ?? WEBHOOK_DEFAULT_TIMEOUT_MS;
  }
  return parsed;
}

type RawRateLimit = { limit: number; window: string | number; per?: "ip" | "user" };

const WINDOW_UNIT_SECONDS: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };

export function rateWindowSeconds(window: string | number): number {
  if (typeof window === "number") {
    return window;
  }
  const match = RATE_WINDOW_PATTERN.exec(window);
  if (!match) {
    throw new SchemaError(`rate limit window ${JSON.stringify(window)} must look like 30s, 10m, 1h, or 1d`);
  }
  const seconds = Number(match[1]) * WINDOW_UNIT_SECONDS[match[2]!]!;
  if (seconds > 7 * 86400) {
    throw new SchemaError(`rate limit window ${window} is longer than 7 days`);
  }
  return seconds;
}

function compileRateLimit(raw: RawRateLimit): RateLimitAST {
  return { limit: raw.limit, windowSeconds: rateWindowSeconds(raw.window), per: raw.per ?? "ip" };
}

function compileEntityRateLimit(raw: Partial<Record<ActionName, RawRateLimit>>): Partial<Record<ActionName, RateLimitAST>> {
  const out: Partial<Record<ActionName, RateLimitAST>> = {};
  for (const action of ["read", "create", "update", "delete"] as const) {
    const rule = raw[action];
    if (rule) {
      out[action] = compileRateLimit(rule);
    }
  }
  return out;
}
