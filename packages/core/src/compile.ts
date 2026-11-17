import { parse as parseYaml } from "yaml";
import { SchemaError } from "./errors.ts";
import { compileBranding } from "./branding.ts";
import { assertIdent } from "./ident.ts";
import { interpolateEnv } from "./interpolate.ts";
import { parsePolicies } from "./policies.ts";
import { topologicalOrder } from "./topo.ts";
import { formatZodError } from "./format-schema.ts";
import { appYamlSchema } from "./yaml-schema.ts";
import { type ActionName, type EntityAST, type PolicyAST, SCHEMA_AST_VERSION, type SchemaAST, WEBHOOK_DEFAULT_MAX_ATTEMPTS, WEBHOOK_DEFAULT_TIMEOUT_MS } from "./ast.ts";
import { findAuthEntity } from "./compile-auth.ts";
import { asFieldObject, assertEntityRouteFree, compileEntityRateLimit, compileField, compileIndexes, defaultPolicies, pluralize, resolveDisplay, systemFields, titleCase } from "./compile-entity.ts";
import { compileJobs } from "./compile-jobs.ts";
import { compileMailRules } from "./compile-mail.ts";
import { compileRuntime } from "./compile-runtime.ts";
import { isDevMode } from "./compile-secrets.ts";

export { RESERVED_ENTITY_NAMES, rateWindowSeconds } from "./compile-entity.ts";
export { DEFAULT_ALLOWED_MIME_TYPES, parseTrustProxy } from "./compile-runtime.ts";
export { DEV_JWT_SECRET, MIN_JWT_SECRET_LENGTH, assertStrongJwtSecret, isDevMode, weakJwtSecretReason } from "./compile-secrets.ts";
export { deserializeAst, serializeAst } from "./compile-serialize.ts";

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
      ...(raw.realtime === true || raw.realtime === "full" ? { realtime: "full" as const } : {}),
      ...(raw.realtime === "ids" ? { realtime: "ids" as const } : {}),
      ...(raw.admin && Object.keys(raw.admin).length > 0 ? { admin: { ...raw.admin } } : {}),
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
  const jobs = compileJobs(yaml);

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
    jobs,
  };
}
