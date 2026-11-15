// src/ast.ts
var SCHEMA_AST_VERSION = 1;
// src/compile.ts
import { parse as parseYaml } from "yaml";

// src/errors.ts
class BakorinError extends Error {
  code;
  details;
  constructor(code, message, details) {
    super(message);
    this.name = "BakorinError";
    this.code = code;
    this.details = details;
  }
}

class SchemaError extends BakorinError {
  constructor(message, details) {
    super("schema_invalid", message, details);
    this.name = "SchemaError";
  }
}

class DiffAbortError extends BakorinError {
  constructor(message, details) {
    super("diff_abort", message, details);
    this.name = "DiffAbortError";
  }
}

class IdentError extends BakorinError {
  constructor(message, details) {
    super("invalid_identifier", message, details);
    this.name = "IdentError";
  }
}

// src/ident.ts
var IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
var RESERVED_PREFIX = "_bakorin";
var SQL_KEYWORDS = new Set([
  "select",
  "insert",
  "update",
  "delete",
  "from",
  "where",
  "table",
  "index",
  "drop",
  "alter",
  "create",
  "join",
  "union",
  "grant",
  "revoke",
  "pragma",
  "vacuum"
]);
function assertIdent(name, kind) {
  if (!IDENT.test(name)) {
    throw new IdentError(`${kind} name ${JSON.stringify(name)} is not a valid identifier`);
  }
  if (name.toLowerCase().startsWith(RESERVED_PREFIX)) {
    throw new IdentError(`${kind} name ${JSON.stringify(name)} uses the reserved _bakorin prefix`);
  }
  if (SQL_KEYWORDS.has(name.toLowerCase())) {
    throw new IdentError(`${kind} name ${JSON.stringify(name)} is a reserved SQL keyword`);
  }
  return name;
}
function isIdent(name) {
  return IDENT.test(name) && !name.toLowerCase().startsWith(RESERVED_PREFIX);
}
function quoteIdent(name) {
  assertIdent(name, "field");
  return `"${name.replaceAll('"', '""')}"`;
}
function quoteChecked(name) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new IdentError(`refusing to quote unsafe identifier ${JSON.stringify(name)}`);
  }
  return `"${name}"`;
}

// src/interpolate.ts
var ENV_TOKEN = /\$\{([A-Z][A-Z0-9_]*)(?::-([^}]*))?\}/g;
function interpolateEnv(source, env = process.env) {
  return source.replace(ENV_TOKEN, (match, name, fallback) => {
    const value = env[name];
    if (value !== undefined && value !== "") {
      return value;
    }
    if (fallback !== undefined) {
      return fallback;
    }
    throw new SchemaError(`missing environment variable ${name} referenced from app.yaml`, { match });
  });
}

// src/policies.ts
var OWNER = /^owner\(([A-Za-z_][A-Za-z0-9_]*)\)$/;
var ROLE = /^role\(([A-Za-z0-9_-]+)\)$/;
function parsePolicy(expr) {
  const trimmed = expr.trim();
  switch (trimmed) {
    case "public":
      return { kind: "public" };
    case "authenticated":
      return { kind: "authenticated" };
    case "admin":
      return { kind: "admin" };
    default: {
      const owner = OWNER.exec(trimmed);
      if (owner?.[1]) {
        return { kind: "owner", field: owner[1] };
      }
      const role = ROLE.exec(trimmed);
      if (role?.[1]) {
        return { kind: "role", role: role[1] };
      }
      throw new SchemaError(invalidPolicyMessage(expr));
    }
  }
}
function invalidPolicyMessage(expr, where) {
  const expected = "Expected public, authenticated, admin, owner(field), or role(name).";
  if (where) {
    return `app.yaml: invalid policy ${JSON.stringify(expr)} on ${where}. ${expected}`;
  }
  return `app.yaml: invalid policy ${JSON.stringify(expr)}. ${expected}`;
}
function parsePolicies(value, fallback, where) {
  if (value === undefined) {
    return fallback;
  }
  const list = Array.isArray(value) ? value : [value];
  return list.map((item) => {
    try {
      return parsePolicy(item);
    } catch (error) {
      if (where && error instanceof SchemaError) {
        throw new SchemaError(invalidPolicyMessage(item, where));
      }
      throw error;
    }
  });
}
function policyRequiresAuth(policies) {
  return policies.every((policy) => policy.kind !== "public");
}
function describePolicy(policy) {
  switch (policy.kind) {
    case "public":
      return "public";
    case "authenticated":
      return "authenticated";
    case "admin":
      return "admin";
    case "owner":
      return `owner(${policy.field})`;
    case "role":
      return `role(${policy.role})`;
    default: {
      const _never = policy;
      return _never;
    }
  }
}

// src/topo.ts
function topologicalOrder(entities) {
  const names = new Set(entities.map((entity) => entity.name));
  const incoming = new Map;
  for (const entity of entities) {
    incoming.set(entity.name, new Set);
  }
  for (const entity of entities) {
    for (const field of entity.fields) {
      const target = field.relation?.to;
      if (!target || target === entity.name) {
        continue;
      }
      if (!names.has(target)) {
        throw new SchemaError(`entity ${entity.name} field ${field.name} relates to unknown entity ${target}`);
      }
      incoming.get(entity.name)?.add(target);
    }
  }
  const ordered = [];
  const remaining = new Set(names);
  while (remaining.size > 0) {
    const ready = [...remaining].filter((name) => (incoming.get(name)?.size ?? 0) === 0);
    if (ready.length === 0) {
      throw new SchemaError("circular relation detected among entities", { remaining: [...remaining] });
    }
    ready.sort();
    for (const name of ready) {
      ordered.push(name);
      remaining.delete(name);
      for (const deps of incoming.values()) {
        deps.delete(name);
      }
    }
  }
  return ordered;
}

// src/format-schema.ts
import { ZodError } from "zod";

// src/yaml-schema.ts
import { z } from "zod";
var ident = z.string().min(1).max(64).regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "must be a letter/underscore followed by letters, digits, or underscores");
var policyExpr = z.string().min(1);
var policyValue = z.union([policyExpr, z.array(policyExpr).min(1)]);
var FIELD_TYPES = [
  "text",
  "email",
  "password",
  "number",
  "integer",
  "boolean",
  "date",
  "datetime",
  "enum",
  "file",
  "relation"
];
var APP_YAML_TOP_LEVEL_KEYS = ["app", "runtime", "auth", "entities", "webhooks"];
var fieldType = z.enum(FIELD_TYPES);
var fieldObject = z.object({
  type: fieldType,
  required: z.boolean().optional(),
  unique: z.boolean().optional(),
  index: z.boolean().optional(),
  default: z.unknown().optional(),
  values: z.array(z.string().min(1)).min(1).optional(),
  to: ident.optional(),
  onDelete: z.enum(["restrict", "cascade", "set_null"]).optional(),
  renameFrom: ident.optional(),
  secret: z.boolean().optional(),
  description: z.string().optional(),
  writable: z.enum(["admin", "none"]).optional(),
  readonly: z.boolean().optional(),
  adminOnly: z.boolean().optional()
}).strict();
var fieldValue = z.union([fieldType, fieldObject]);
var entityObject = z.object({
  label: z.string().optional(),
  plural: z.string().optional(),
  display: ident.optional(),
  description: z.string().optional(),
  auth: z.boolean().optional(),
  fields: z.record(ident, fieldValue),
  indexes: z.array(z.union([ident, z.array(ident).min(1)])).optional(),
  policies: z.object({
    read: policyValue.optional(),
    create: policyValue.optional(),
    update: policyValue.optional(),
    delete: policyValue.optional()
  }).strict().optional()
}).strict();
var webhookObject = z.object({
  entity: z.union([ident, z.literal("*")]),
  events: z.array(z.enum(["create", "update", "delete"])).min(1),
  url: z.string().min(1),
  secret: z.string().optional()
}).strict();
var appYamlSchema = z.object({
  app: z.object({
    name: z.string().min(1),
    version: z.string().optional(),
    description: z.string().optional()
  }).strict(),
  runtime: z.object({
    dialect: z.enum(["sqlite", "postgres"]).optional(),
    host: z.string().optional(),
    port: z.number().int().positive().optional(),
    sqlite: z.object({
      path: z.string().min(1)
    }).strict().optional(),
    postgres: z.object({
      url: z.string().min(1)
    }).strict().optional(),
    jwt: z.object({
      secret: z.string().min(1).optional(),
      accessTtlSeconds: z.number().int().positive().optional(),
      refreshTtlSeconds: z.number().int().positive().optional()
    }).strict().optional(),
    files: z.object({
      driver: z.enum(["local", "s3"]).optional(),
      path: z.string().optional(),
      bucket: z.string().optional(),
      endpoint: z.string().optional(),
      accessKey: z.string().optional(),
      secretKey: z.string().optional(),
      region: z.string().optional(),
      virtualHostedStyle: z.boolean().optional(),
      pathStyle: z.boolean().optional(),
      maxBytes: z.number().int().positive().optional(),
      allowedMimeTypes: z.array(z.string().min(1)).optional(),
      signedUrlTtlSeconds: z.number().int().positive().optional()
    }).strict().optional(),
    backups: z.object({
      interval: z.string().optional(),
      cron: z.string().optional(),
      retain: z.number().int().positive().optional(),
      destination: z.string().optional()
    }).strict().optional(),
    cors: z.object({
      origins: z.array(z.string()).optional()
    }).strict().optional(),
    hooks: z.string().optional()
  }).strict().optional(),
  auth: z.object({
    entity: ident.optional(),
    identity: ident.optional(),
    password: ident.optional(),
    role: ident.optional(),
    adminRole: z.string().optional(),
    requireVerifiedEmail: z.boolean().optional()
  }).strict().optional(),
  entities: z.record(ident, entityObject).refine((value) => Object.keys(value).length > 0, {
    message: "at least one entity is required"
  }),
  webhooks: z.array(webhookObject).optional()
}).strict();

// src/format-schema.ts
var IDENT2 = /^[A-Za-z_][A-Za-z0-9_]*$/;
var TOP_LEVEL = new Set(APP_YAML_TOP_LEVEL_KEYS);
var FIELD_TYPE_SET = new Set(FIELD_TYPES);
function isAppYamlValidationError(error) {
  return error instanceof SchemaError || error instanceof ZodError;
}
function formatAppYamlError(error) {
  if (error instanceof ZodError) {
    return formatZodError(error);
  }
  if (error instanceof SchemaError) {
    return prefixLines(error.message);
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
function formatZodError(error) {
  const lines = flattenZodIssues(error).map(formatIssue).flat();
  const unique = [...new Set(lines.filter((line) => line.length > 0))];
  return unique.length > 0 ? unique.join(`
`) : "app.yaml: schema is invalid";
}
function prefixLines(message) {
  return message.split(`
`).map((line) => {
    const trimmed = line.trimEnd();
    if (trimmed.length === 0) {
      return trimmed;
    }
    return trimmed.startsWith("app.yaml:") ? trimmed : `app.yaml: ${trimmed}`;
  }).join(`
`);
}
function flattenZodIssues(error) {
  const out = [];
  for (const issue of error.issues) {
    if (issue.code === "invalid_union") {
      const children = issue.unionErrors.flatMap((child) => flattenZodIssues(child));
      out.push(...preferUsefulIssues(children, issue.path));
      continue;
    }
    out.push(issue);
  }
  return out;
}
function preferUsefulIssues(issues, path) {
  const ranked = issues.filter((issue) => issue.code === "unrecognized_keys" || issue.code === "invalid_enum_value" || issue.code === "invalid_string" && issue.path.length >= path.length);
  if (ranked.length > 0) {
    return ranked;
  }
  const first = issues[0];
  return first ? [first] : [];
}
function looksLikeEntityName(key) {
  return IDENT2.test(key) && !TOP_LEVEL.has(key);
}
function pathLabel(path) {
  return path.map(String).join(".");
}
function isFieldTypeIssue(issue) {
  if (issue.code !== "invalid_enum_value") {
    return false;
  }
  const options = issue.options.map(String);
  return options.every((option) => FIELD_TYPE_SET.has(option)) && FIELD_TYPES.every((type) => options.includes(type));
}
function formatIssue(issue) {
  const path = pathLabel(issue.path);
  const at = path.length > 0 ? ` at ${path}` : "";
  switch (issue.code) {
    case "unrecognized_keys":
      return issue.keys.map((key) => {
        if (issue.path.length === 0 && looksLikeEntityName(key)) {
          return `app.yaml: unknown top-level key "${key}". Did you mean to put it under "entities:"?`;
        }
        if (issue.path[0] === "entities" && issue.path.length === 2) {
          return `app.yaml: unknown key "${key}" on entity ${String(issue.path[1])}${hintEntityKeys()}`;
        }
        return `app.yaml: unknown key "${key}"${at}`;
      });
    case "invalid_enum_value": {
      if (isFieldTypeIssue(issue)) {
        return [
          `app.yaml: unknown field type ${JSON.stringify(issue.received)}${at}. Valid types: ${FIELD_TYPES.join(", ")}`
        ];
      }
      return [`app.yaml: invalid value ${JSON.stringify(issue.received)}${at}. Expected ${issue.options.join(", ")}`];
    }
    case "invalid_type": {
      if (issue.received === "undefined") {
        if (issue.path.length === 1 && issue.path[0] === "entities") {
          return [`app.yaml: missing "entities". At least one entity is required.`];
        }
        if (issue.path.length === 1 && issue.path[0] === "app") {
          return [`app.yaml: missing "app" (needs app.name).`];
        }
        return [`app.yaml: missing "${path}"`];
      }
      return [`app.yaml: ${path || "root"} should be ${issue.expected}, not ${issue.received}`];
    }
    case "too_small":
      if (issue.path.length === 1 && issue.path[0] === "entities") {
        return [`app.yaml: missing "entities". At least one entity is required.`];
      }
      return [`app.yaml: ${path || "value"} is too small`];
    case "custom":
      return [`app.yaml: ${issue.message}${at}`];
    default:
      return [`app.yaml: ${issue.message}${at}`];
  }
}
function hintEntityKeys() {
  return ". Valid keys are label, plural, display, description, auth, fields, indexes, policies.";
}

// src/compile.ts
var SYSTEM_FIELDS = new Set(["id", "createdAt", "updatedAt"]);
function asFieldObject(value) {
  if (typeof value === "string") {
    return { type: value };
  }
  return value;
}
function parseIntervalHours(value) {
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
function compileField(entityName, name, raw) {
  assertIdent(name, "field");
  if (SYSTEM_FIELDS.has(name)) {
    throw new SchemaError(`${entityName}.${name} is a reserved system field`);
  }
  const type = raw.type;
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
    relation: raw.to ? {
      to: raw.to,
      onDelete: raw.onDelete ?? "restrict"
    } : undefined,
    renameFrom: raw.renameFrom,
    secret: raw.secret === true || type === "password",
    description: raw.description,
    writable: compileWritable(entityName, name, raw)
  };
}
function compileWritable(entityName, name, raw) {
  const flags = [raw.writable, raw.readonly === true ? "none" : undefined, raw.adminOnly === true ? "admin" : undefined].filter((value) => value === "admin" || value === "none");
  const unique = [...new Set(flags)];
  if (unique.length > 1) {
    throw new SchemaError(`${entityName}.${name} has conflicting writable/readonly/adminOnly flags`);
  }
  return unique[0] ?? "any";
}
function systemFields() {
  return [
    {
      name: "id",
      type: "text",
      required: true,
      unique: true,
      indexed: true,
      defaultValue: undefined,
      secret: false,
      writable: "none"
    },
    {
      name: "createdAt",
      type: "datetime",
      required: true,
      unique: false,
      indexed: true,
      defaultValue: undefined,
      secret: false,
      writable: "none"
    },
    {
      name: "updatedAt",
      type: "datetime",
      required: true,
      unique: false,
      indexed: true,
      defaultValue: undefined,
      secret: false,
      writable: "none"
    }
  ];
}
function defaultPolicies(auth) {
  if (auth) {
    return {
      read: [{ kind: "authenticated" }],
      create: [{ kind: "admin" }],
      update: [{ kind: "owner", field: "id" }],
      delete: [{ kind: "admin" }]
    };
  }
  return {
    read: [{ kind: "authenticated" }],
    create: [{ kind: "authenticated" }],
    update: [{ kind: "authenticated" }],
    delete: [{ kind: "authenticated" }]
  };
}
function resolveDisplay(entityName, fields, requested) {
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
function titleCase(name) {
  return name.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}
function pluralize(name) {
  if (name.endsWith("s")) {
    return name;
  }
  if (name.endsWith("y") && name.length > 1 && !/[aeiou]y$/i.test(name)) {
    return `${name.slice(0, -1)}ies`;
  }
  return `${name}s`;
}
function firstEnv(env, names) {
  for (const name of names) {
    const value = env[name];
    if (value !== undefined && value !== "") {
      return value;
    }
  }
  return;
}
function joinPosix(base, child) {
  if (child.startsWith("/") || /^[A-Za-z]:[\\/]/.test(child)) {
    return child;
  }
  return `${base.replace(/[/\\]+$/, "")}/${child.replace(/^[/\\]+/, "")}`;
}
function parsePort(runtimePort, env) {
  const raw = firstEnv(env, ["PORT"]) ?? (runtimePort !== undefined ? String(runtimePort) : undefined);
  const port = raw ? Number(raw) : 4371;
  return Number.isFinite(port) && port > 0 ? port : 4371;
}
function parseVirtualHostedStyle(files, env) {
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
function compileRuntime(yaml, production, env) {
  const runtime = yaml.runtime ?? {};
  const dialect = runtime.dialect ?? (runtime.postgres?.url ? "postgres" : "sqlite");
  const jwtSecret = runtime.jwt?.secret ?? env.JWT_SECRET ?? (production ? "" : "dev-only-change-me");
  if (production && (!jwtSecret || jwtSecret === "dev-only-change-me")) {
    throw new SchemaError("JWT_SECRET is required in production");
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
  const driver = filesDriverEnv === "local" || filesDriverEnv === "s3" ? filesDriverEnv : bucket ? "s3" : runtime.files?.driver ?? "local";
  const yamlSqlite = runtime.sqlite?.path ?? "./data/app.db";
  const sqliteFile = yamlSqlite.split(/[/\\]/).pop() ?? "app.db";
  const sqlitePath = dataDir ? joinPosix(dataDir, sqliteFile) : yamlSqlite;
  const yamlFilesPath = runtime.files?.path ?? "./data/uploads";
  const filesPath = driver === "local" && dataDir ? joinPosix(dataDir, "uploads") : yamlFilesPath;
  const yamlDest = runtime.backups?.destination;
  const backupPrefix = firstEnv(env, ["BAKORIN_BACKUP_PREFIX"]) ?? "backups";
  const destination = firstEnv(env, ["BAKORIN_BACKUP_DESTINATION"]) ?? (yamlDest?.startsWith("s3://") ? yamlDest : undefined) ?? (bucket ? `s3://${bucket}/${backupPrefix}` : undefined) ?? (dataDir ? joinPosix(dataDir, "backups") : undefined) ?? yamlDest ?? "./data/backups";
  return {
    dialect,
    host: runtime.host ?? "0.0.0.0",
    port: parsePort(runtime.port, env),
    sqlitePath,
    postgresUrl: runtime.postgres?.url,
    jwtSecret,
    jwtSecretPrevious: firstEnv(env, ["JWT_SECRET_PREVIOUS"]),
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
      signedUrlTtlSeconds: runtime.files?.signedUrlTtlSeconds ?? 900
    },
    backups: {
      intervalHours: parseIntervalHours(runtime.backups?.interval),
      cron: runtime.backups?.cron,
      retain: runtime.backups?.retain ?? 14,
      destination
    },
    corsOrigins: parseCorsOrigins(runtime.cors?.origins, env),
    hooksPath: runtime.hooks,
    appUrl: parseAppUrl(env, parsePort(runtime.port, env))
  };
}
function parseCorsOrigins(yamlOrigins, env) {
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
function parseAppUrl(env, port) {
  const raw = firstEnv(env, ["APP_URL", "BAKORIN_APP_URL"]) ?? `http://127.0.0.1:${port}`;
  return raw.replace(/\/+$/, "");
}
var DEFAULT_ALLOWED_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "application/pdf",
  "text/plain"
];
function parseAllowedMime(raw) {
  if (!raw || raw.length === 0) {
    return [...DEFAULT_ALLOWED_MIME_TYPES];
  }
  if (raw.includes("*")) {
    return ["*"];
  }
  return raw;
}
function compileIndexes(entityName, fieldMap, raw) {
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
function findAuthEntity(yaml, entities) {
  const marked = entities.filter((entity) => entity.auth);
  const configured = yaml.auth?.entity;
  let entity;
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
  entity.fieldMap[identityField].unique = true;
  entity.fieldMap[identityField].required = true;
  entity.fieldMap[passwordField].required = true;
  entity.fieldMap[passwordField].secret = true;
  entity.fieldMap[roleField].writable = "admin";
  ensureEmailVerifiedField(entity);
  return {
    entity: entity.name,
    identityField,
    passwordField,
    roleField,
    adminRole,
    requireVerifiedEmail: yaml.auth?.requireVerifiedEmail === true
  };
}
function ensureEmailVerifiedField(entity) {
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
  const field = {
    name: "emailVerified",
    type: "boolean",
    required: false,
    unique: false,
    indexed: false,
    defaultValue: false,
    secret: false,
    writable: "admin",
    description: "True after the user confirms their email, or when an admin marks them verified."
  };
  entity.fields.push(field);
  entity.fieldMap.emailVerified = field;
}
function compileAppYaml(source, options = {}) {
  const env = options.env ?? process.env;
  const interpolated = interpolateEnv(source, env);
  let parsed;
  try {
    parsed = parseYaml(interpolated);
  } catch (error) {
    throw new SchemaError(`app.yaml is not valid YAML: ${error instanceof Error ? error.message : String(error)}`);
  }
  const parsedYaml = appYamlSchema.safeParse(parsed);
  if (!parsedYaml.success) {
    throw new SchemaError(formatZodError(parsedYaml.error));
  }
  const yaml = parsedYaml.data;
  const production = options.production ?? (env.NODE_ENV === "production" || env.BAKORIN_ENV === "production");
  const runtime = compileRuntime(yaml, production, env);
  const entities = Object.entries(yaml.entities).map(([name, raw]) => {
    assertIdent(name, "entity");
    const compiledFields = Object.entries(raw.fields).map(([fieldName, fieldRaw]) => compileField(name, fieldName, asFieldObject(fieldRaw)));
    const fields = [...systemFields(), ...compiledFields];
    const fieldMap = Object.fromEntries(fields.map((field) => [field.name, field]));
    const fallback = defaultPolicies(raw.auth === true || name === yaml.auth?.entity);
    const policies = {
      read: parsePolicies(raw.policies?.read, fallback.read, `entities.${name}.policies.read`),
      create: parsePolicies(raw.policies?.create, fallback.create, `entities.${name}.policies.create`),
      update: parsePolicies(raw.policies?.update, fallback.update, `entities.${name}.policies.update`),
      delete: parsePolicies(raw.policies?.delete, fallback.delete, `entities.${name}.policies.delete`)
    };
    for (const action of ["read", "create", "update", "delete"]) {
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
      deprecated: false
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
      secret: hook.secret
    };
  });
  return {
    version: SCHEMA_AST_VERSION,
    appName: yaml.app.name,
    appVersion: yaml.app.version ?? "0.1.0",
    appDescription: yaml.app.description,
    runtime,
    entities,
    entityMap,
    order,
    auth,
    webhooks
  };
}
function serializeAst(ast) {
  return JSON.stringify({
    version: ast.version,
    appName: ast.appName,
    appVersion: ast.appVersion,
    appDescription: ast.appDescription,
    runtime: ast.runtime,
    entities: ast.entities,
    order: ast.order,
    auth: ast.auth,
    webhooks: ast.webhooks
  });
}
function deserializeAst(raw) {
  const parsed = JSON.parse(raw);
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
  return parsed;
}
// src/diff.ts
var WIDENING = {
  text: ["text", "email"],
  email: ["email", "text"],
  password: ["password"],
  number: ["number"],
  integer: ["integer", "number"],
  boolean: ["boolean"],
  date: ["date", "datetime"],
  datetime: ["datetime"],
  enum: ["enum"],
  file: ["file"],
  relation: ["relation"]
};
function fieldMapByRename(entity) {
  const map = new Map;
  for (const field of entity.fields) {
    map.set(field.name, field);
    if (field.renameFrom) {
      map.set(field.renameFrom, field);
    }
  }
  return map;
}
function isAdditiveField(field) {
  return !field.required || field.defaultValue !== undefined || field.name === "id";
}
function typeCompatible(from, to) {
  if (from.type !== to.type) {
    return (WIDENING[from.type] ?? []).includes(to.type);
  }
  if (from.type === "relation") {
    return from.relation?.to === to.relation?.to;
  }
  if (from.type === "enum") {
    const oldValues = new Set(from.enumValues ?? []);
    return (to.enumValues ?? []).every((value) => oldValues.has(value)) ? true : (from.enumValues ?? []).every((value) => (to.enumValues ?? []).includes(value));
  }
  return true;
}
function enumOnlyAdded(from, to) {
  if (from.type !== "enum" || to.type !== "enum") {
    return false;
  }
  const oldValues = new Set(from.enumValues ?? []);
  return (to.enumValues ?? []).every((value) => oldValues.has(value)) === false ? (from.enumValues ?? []).every((value) => (to.enumValues ?? []).includes(value)) : from.enumValues?.join() === to.enumValues?.join();
}
function diffSchemas(from, to) {
  const plan = { auto: [], safe: [], deprecate: [], abort: [] };
  if (!from) {
    for (const name of to.order) {
      const entity = to.entityMap[name];
      if (entity) {
        plan.auto.push({ tier: "auto", kind: "add_entity", entity });
      }
    }
    return plan;
  }
  const fromEntities = new Map(from.entities.map((entity) => [entity.name, entity]));
  const toEntities = new Map(to.entities.map((entity) => [entity.name, entity]));
  const consumedFrom = new Set;
  for (const next of to.entities) {
    const renameFrom = next.fields.find((field) => field.renameFrom && field.renameFrom === next.name);
    let prev = fromEntities.get(next.name);
    if (!prev) {
      const renamed = from.entities.find((candidate) => {
        if (consumedFrom.has(candidate.name)) {
          return false;
        }
        const overlap = candidate.fields.filter((field) => next.fieldMap[field.name] || next.fields.some((n) => n.renameFrom === field.name));
        return overlap.length >= Math.min(2, candidate.fields.length) && candidate.auth === next.auth;
      });
      if (renamed && next.fields.some((field) => field.renameFrom)) {}
    }
    if (!prev) {
      plan.auto.push({ tier: "auto", kind: "add_entity", entity: next });
      continue;
    }
    consumedFrom.add(prev.name);
    diffEntity(prev, next, plan);
  }
  for (const prev of from.entities) {
    if (!consumedFrom.has(prev.name) && !toEntities.has(prev.name)) {
      plan.deprecate.push({ tier: "deprecate", kind: "drop_entity", entity: prev.name });
    }
  }
  return plan;
}
function diffEntity(prev, next, plan) {
  const prevFields = new Map(prev.fields.map((field) => [field.name, field]));
  const matchedPrev = new Set;
  const nextByRename = fieldMapByRename(next);
  for (const field of next.fields) {
    if (field.name === "id" || field.name === "createdAt" || field.name === "updatedAt") {
      const existing = prevFields.get(field.name);
      if (existing) {
        matchedPrev.add(field.name);
      }
      continue;
    }
    let oldField = prevFields.get(field.name);
    if (!oldField && field.renameFrom) {
      oldField = prevFields.get(field.renameFrom);
      if (oldField) {
        plan.safe.push({
          tier: "safe",
          kind: "rename_field",
          entity: next.name,
          from: oldField.name,
          to: field.name
        });
        matchedPrev.add(oldField.name);
        compareField(next.name, oldField, field, plan);
        continue;
      }
      plan.abort.push({
        tier: "abort",
        kind: "breaking",
        message: `${next.name}.${field.name} renameFrom ${field.renameFrom} does not exist on the current schema`
      });
      continue;
    }
    if (!oldField) {
      if (!isAdditiveField(field)) {
        plan.abort.push({
          tier: "abort",
          kind: "breaking",
          message: `cannot add required field ${next.name}.${field.name} without a default`
        });
        continue;
      }
      plan.auto.push({ tier: "auto", kind: "add_field", entity: next.name, field });
      continue;
    }
    matchedPrev.add(oldField.name);
    compareField(next.name, oldField, field, plan);
  }
  for (const oldField of prev.fields) {
    if (oldField.name === "id" || oldField.name === "createdAt" || oldField.name === "updatedAt") {
      continue;
    }
    if (!matchedPrev.has(oldField.name) && !nextByRename.has(oldField.name)) {
      plan.deprecate.push({ tier: "deprecate", kind: "drop_field", entity: next.name, field: oldField.name });
    }
  }
  const prevKeys = new Set((prev.indexes ?? []).map((fields) => fields.join(",")));
  for (const fields of next.indexes ?? []) {
    const key = fields.join(",");
    if (!prevKeys.has(key)) {
      plan.auto.push({ tier: "auto", kind: "add_index", entity: next.name, fields });
    }
  }
}
function compareField(entity, from, to, plan) {
  if (from.type !== to.type && !typeCompatible(from, to)) {
    plan.abort.push({
      tier: "abort",
      kind: "breaking",
      message: `cannot change ${entity}.${from.name} from ${from.type} to ${to.type}`
    });
    return;
  }
  if (from.type === "relation" && to.type === "relation" && from.relation?.to !== to.relation?.to) {
    plan.abort.push({
      tier: "abort",
      kind: "breaking",
      message: `cannot retarget relation ${entity}.${from.name} from ${from.relation?.to} to ${to.relation?.to}`
    });
  }
  if (from.type === "enum" && to.type === "enum") {
    const removed = (from.enumValues ?? []).filter((value) => !(to.enumValues ?? []).includes(value));
    if (removed.length > 0 && !enumOnlyAdded(from, to)) {
      plan.abort.push({
        tier: "abort",
        kind: "breaking",
        message: `cannot remove enum values ${removed.join(", ")} from ${entity}.${from.name}`
      });
    }
  }
  if (!from.unique && to.unique) {
    plan.abort.push({
      tier: "abort",
      kind: "breaking",
      message: `cannot add unique to existing field ${entity}.${from.name} (may fail on existing rows)`
    });
  }
  if (!from.required && to.required && to.defaultValue === undefined) {
    plan.abort.push({
      tier: "abort",
      kind: "breaking",
      message: `cannot make ${entity}.${from.name} required without a default`
    });
  }
  if (!from.indexed && to.indexed) {
    plan.auto.push({ tier: "auto", kind: "add_index", entity, fields: [to.name] });
  }
}
function assertPlanApplyable(plan) {
  if (plan.abort.length > 0) {
    const messages = plan.abort.map((change) => change.kind === "breaking" ? change.message : change.kind);
    throw new DiffAbortError(`schema changes abort because they are breaking:
- ${messages.join(`
- `)}`, messages);
  }
}
// src/typegen.ts
function tsType(field) {
  switch (field.type) {
    case "text":
    case "email":
    case "password":
    case "date":
    case "datetime":
    case "file":
      return "string";
    case "number":
      return "number";
    case "integer":
      return "number";
    case "boolean":
      return "boolean";
    case "enum":
      return (field.enumValues ?? []).map((value) => JSON.stringify(value)).join(" | ") || "string";
    case "relation":
      return "string";
    default: {
      const _never = field.type;
      return _never;
    }
  }
}
function pascal(name) {
  return name.replace(/(^[a-z])|([-_][a-z])/g, (chunk) => chunk.replace(/[-_]/, "").toUpperCase());
}
function fieldLine(field) {
  if (field.secret) {
    return `  // ${field.name} is write-only and never returned`;
  }
  const optional = field.required ? "" : "?";
  return `  ${field.name}${optional}: ${tsType(field)};`;
}
function entityInterface(entity) {
  const lines = entity.fields.filter((field) => !field.secret).map(fieldLine);
  const writes = entity.fields.filter((field) => field.name !== "id" && field.name !== "createdAt" && field.name !== "updatedAt").map((field) => {
    const optional = field.required && field.defaultValue === undefined ? "" : "?";
    return `  ${field.name}${optional}: ${tsType(field)};`;
  });
  const name = pascal(entity.name);
  return `export interface ${name} {
${lines.join(`
`)}
}

export interface ${name}Write {
${writes.join(`
`)}
}
`;
}
function generateTypes(ast) {
  const interfaces = ast.entities.map(entityInterface).join(`
`);
  const mapLines = ast.entities.map((entity) => `  ${entity.name}: ${pascal(entity.name)};`).join(`
`);
  const writeMap = ast.entities.map((entity) => `  ${entity.name}: ${pascal(entity.name)}Write;`).join(`
`);
  return `/* Generated by bakorin. Do not edit. */

${interfaces}
export interface BakorinEntities {
${mapLines}
}

export interface BakorinWrites {
${writeMap}
}

export type BakorinEntityName = keyof BakorinEntities;
`;
}
export {
  APP_YAML_TOP_LEVEL_KEYS,
  BakorinError,
  DEFAULT_ALLOWED_MIME_TYPES,
  DiffAbortError,
  FIELD_TYPES,
  IdentError,
  SCHEMA_AST_VERSION,
  SchemaError,
  appYamlSchema,
  assertIdent,
  assertPlanApplyable,
  compileAppYaml,
  describePolicy,
  deserializeAst,
  diffSchemas,
  formatAppYamlError,
  formatZodError,
  generateTypes,
  interpolateEnv,
  invalidPolicyMessage,
  isAppYamlValidationError,
  isIdent,
  parsePolicies,
  parsePolicy,
  policyRequiresAuth,
  quoteChecked,
  quoteIdent,
  serializeAst,
  topologicalOrder
};
