/** Fields, policies, indexes, display, names, and rate limits for one entity. */

import { SchemaError } from "./errors.ts";
import { assertIdent } from "./ident.ts";
import { type AppYaml, RATE_WINDOW_PATTERN, type RawField } from "./yaml-schema.ts";
import type { ActionName, FieldAST, FieldTypeName, FieldWritable, PolicyAST, RateLimitAST } from "./ast.ts";

export const SYSTEM_FIELDS = new Set(["id", "createdAt", "updatedAt"]);

export function asFieldObject(value: AppYaml["entities"][string]["fields"][string]): RawField {
  if (typeof value === "string") {
    return { type: value };
  }
  return value;
}

export function compileField(entityName: string, name: string, raw: RawField): FieldAST {
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
  if (raw.many !== undefined && type !== "relation") {
    throw new SchemaError(`${entityName}.${name} has many: but is not a relation`);
  }
  if (raw.many === true) {
    if (raw.unique === true || raw.index === true) {
      throw new SchemaError(`${entityName}.${name} is a many to many relation and cannot be unique or indexed (its join table is indexed already)`);
    }
    if (raw.default !== undefined) {
      throw new SchemaError(`${entityName}.${name} is a many to many relation and cannot have a default`);
    }
    if (raw.onDelete !== undefined) {
      throw new SchemaError(`${entityName}.${name} is a many to many relation: links are always removed when either record is deleted, so leave out onDelete`);
    }
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
    indexed: raw.index === true || raw.unique === true || (type === "relation" && raw.many !== true),
    defaultValue: raw.default,
    enumValues: raw.values,
    relation: raw.to
      ? {
          to: raw.to,
          onDelete: raw.onDelete ?? "restrict",
          ...(raw.many === true ? { many: true } : {}),
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

export function systemFields(): FieldAST[] {
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

export function defaultPolicies(auth: boolean): Record<ActionName, PolicyAST[]> {
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

export function resolveDisplay(entityName: string, fields: FieldAST[], requested: string | undefined): string {
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

export function titleCase(name: string): string {
  return name
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function pluralize(name: string): string {
  if (name.endsWith("s")) {
    return name;
  }
  if (name.endsWith("y") && name.length > 1 && !/[aeiou]y$/i.test(name)) {
    return `${name.slice(0, -1)}ies`;
  }
  return `${name}s`;
}

/**
 * runtime.trustProxy (or TRUST_PROXY): false or 0 for none, a hop count such as 1,
 * true for one hop, or a list of proxy CIDRs. The env var wins so a host can set it.
 */
/** API prefixes Bakorin mounts under /api/v1. An entity with one of these names would be shadowed. */
export const RESERVED_ENTITY_NAMES = ["auth", "audit", "backups", "docs", "files", "mail", "realtime", "status", "webhooks", "_meta"] as const;

export function assertEntityRouteFree(name: string): void {
  if ((RESERVED_ENTITY_NAMES as readonly string[]).includes(name.toLowerCase())) {
    throw new SchemaError(
      `entity name "${name}" is reserved because /api/v1/${name.toLowerCase()} is a built in route. Rename the entity, for example to "${name}_items" or a more specific name.`,
    );
  }
}

export function compileIndexes(entityName: string, fieldMap: Record<string, { name: string }>, raw: Array<string | string[]> | undefined): string[][] {
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

export function compileRateLimit(raw: RawRateLimit): RateLimitAST {
  return { limit: raw.limit, windowSeconds: rateWindowSeconds(raw.window), per: raw.per ?? "ip" };
}

export function compileEntityRateLimit(raw: Partial<Record<ActionName, RawRateLimit>>): Partial<Record<ActionName, RateLimitAST>> {
  const out: Partial<Record<ActionName, RateLimitAST>> = {};
  for (const action of ["read", "create", "update", "delete"] as const) {
    const rule = raw[action];
    if (rule) {
      out[action] = compileRateLimit(rule);
    }
  }
  return out;
}
