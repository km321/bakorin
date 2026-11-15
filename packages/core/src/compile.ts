import { parse as parseYaml } from "yaml";
import { SchemaError } from "./errors.ts";
import { assertIdent } from "./ident.ts";
import { interpolateEnv } from "./interpolate.ts";
import { parsePolicies } from "./policies.ts";
import { topologicalOrder } from "./topo.ts";
import { formatZodError } from "./format-schema.ts";
import { appYamlSchema, type AppYaml, type RawField } from "./yaml-schema.ts";
import {
  SCHEMA_AST_VERSION,
  type ActionName,
  type AuthAST,
  type EntityAST,
  type FieldAST,
  type FieldTypeName,
  type FieldWritable,
  type PolicyAST,
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
      read: [{ kind: "authenticated" }],
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

function compileRuntime(yaml: AppYaml, production: boolean, env: Record<string, string | undefined>): RuntimeAST {
  const runtime = yaml.runtime ?? {};
  const dialect = runtime.dialect ?? (runtime.postgres?.url ? "postgres" : "sqlite");
  const jwtSecret = runtime.jwt?.secret ?? env.JWT_SECRET ?? (production ? "" : DEV_JWT_SECRET);
  if (production && (!jwtSecret || jwtSecret === DEV_JWT_SECRET)) {
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
      signedUrlTtlSeconds: runtime.files?.signedUrlTtlSeconds ?? 900,
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
  };
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
  return {
    entity: entity.name,
    identityField,
    passwordField,
    roleField,
    adminRole,
    requireVerifiedEmail: yaml.auth?.requireVerifiedEmail === true,
  };
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
  const parsedYaml = appYamlSchema.safeParse(parsed);
  if (!parsedYaml.success) {
    throw new SchemaError(formatZodError(parsedYaml.error));
  }
  const yaml = parsedYaml.data;
  const production =
    options.production ?? (env.NODE_ENV === "production" || env.BAKORIN_ENV === "production");
  const runtime = compileRuntime(yaml, production, env);

  const entities: EntityAST[] = Object.entries(yaml.entities).map(([name, raw]) => {
    assertIdent(name, "entity");
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
    webhooks,
  };
}

export function serializeAst(ast: SchemaAST): string {
  return JSON.stringify({
    version: ast.version,
    appName: ast.appName,
    appVersion: ast.appVersion,
    appDescription: ast.appDescription,
    runtime: ast.runtime,
    entities: ast.entities,
    order: ast.order,
    auth: ast.auth,
    webhooks: ast.webhooks,
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
