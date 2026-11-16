import { sql, type SelectQueryBuilder } from "kysely";
import { quoteChecked, type EntityAST, type FieldAST } from "@bakorin/core";
import { decodeValue, encodeValue } from "../db/types.ts";
import type { BakorinDb } from "../db/dialects.ts";
import type { AccessDecision } from "./policies-sql.ts";

/** `%text%` with LIKE wildcards in the text escaped, lowercased for a case insensitive match. */
export function likePattern(value: string): string {
  return `%${value.toLowerCase().replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
}

const OPS = new Set(["eq", "neq", "gt", "gte", "lt", "lte", "like", "in", "isnull"]);

export interface ListQuery {
  limit: number;
  offset: number;
  sort: Array<{ field: string; dir: "asc" | "desc" }>;
  filters: Array<{ field: string; op: string; value: unknown }>;
  expand: string[];
}

/** privateAllowed: false drops filters and sorts on private fields, so they cannot be probed. */
export function parseListQuery(entity: EntityAST, search: URLSearchParams, options: { privateAllowed?: boolean } = {}): ListQuery {
  const privateAllowed = options.privateAllowed !== false;
  const limit = Math.min(100, Math.max(1, Number(search.get("limit") ?? 50) || 50));
  const offset = Math.max(0, Number(search.get("offset") ?? 0) || 0);
  const sort: ListQuery["sort"] = [];
  const sortRaw = search.get("sort") ?? "-createdAt";
  for (const part of sortRaw.split(",").map((item) => item.trim()).filter(Boolean)) {
    const dir = part.startsWith("-") ? "desc" : "asc";
    const field = part.replace(/^-/, "");
    if (!entity.fieldMap[field] || entity.fieldMap[field]?.secret || (!privateAllowed && entity.fieldMap[field]?.private)) {
      continue;
    }
    sort.push({ field, dir });
  }
  const filters: ListQuery["filters"] = [];
  for (const [key, value] of search.entries()) {
    const match = /^filter\[([A-Za-z_][A-Za-z0-9_]*)\](?:\[([a-z]+)\])?$/.exec(key);
    if (!match?.[1]) {
      continue;
    }
    const fieldName = match[1];
    const field = entity.fieldMap[fieldName];
    if (!field || field.secret || (!privateAllowed && field.private)) {
      continue;
    }
    const op = match[2] ?? "eq";
    if (!OPS.has(op)) {
      continue;
    }
    filters.push({ field: fieldName, op, value: op === "in" ? value.split(",") : value });
  }
  const expand = (search.get("expand") ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((name) => Boolean(entity.fieldMap[name]?.relation));
  return { limit, offset, sort, filters, expand };
}

type QB = SelectQueryBuilder<Record<string, Record<string, unknown>>, string, Record<string, unknown>>;

export function applyFilters(
  qb: QB,
  entity: EntityAST,
  query: ListQuery,
  dialect: "sqlite" | "postgres",
): QB {
  let next = qb;
  for (const filter of query.filters) {
    const field = entity.fieldMap[filter.field] as FieldAST;
    const encoded = Array.isArray(filter.value)
      ? filter.value.map((item) => encodeValue(dialect, field, item))
      : encodeValue(dialect, field, filter.value);
    const col = quoteChecked(filter.field);
    switch (filter.op) {
      case "eq":
        next = next.where(filter.field, "=", encoded);
        break;
      case "neq":
        next = next.where(filter.field, "!=", encoded);
        break;
      case "gt":
        next = next.where(filter.field, ">", encoded);
        break;
      case "gte":
        next = next.where(filter.field, ">=", encoded);
        break;
      case "lt":
        next = next.where(filter.field, "<", encoded);
        break;
      case "lte":
        next = next.where(filter.field, "<=", encoded);
        break;
      case "like":
        // Same on SQLite and Postgres: a case insensitive substring match where
        // % and _ in the search text are literal characters.
        next = next.where(sql<boolean>`lower(cast(${sql.ref(filter.field)} as text)) like ${likePattern(String(filter.value))} escape '\\'`);
        break;
      case "in":
        next = next.where(filter.field, "in", encoded as unknown[]);
        break;
      case "isnull":
        next = String(filter.value) === "false" ? next.where(filter.field, "is not", null) : next.where(filter.field, "is", null);
        break;
      default:
        void col;
    }
  }
  return next;
}

export function applyAccess(qb: QB, decision: AccessDecision): QB {
  if (decision.ownerFields.length === 0 || !decision.actorId) {
    return qb;
  }
  const actorId = decision.actorId;
  return qb.where((eb) => eb.or(decision.ownerFields.map((field) => eb(field, "=", actorId))));
}

export function decodeRow(entity: EntityAST, row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    out[key] = decodeValue(entity.fieldMap[key], value);
  }
  return out;
}

export async function expandRows(
  db: BakorinDb,
  entity: EntityAST,
  rows: Record<string, unknown>[],
  expand: string[],
  relatedAccess: (name: string) => AccessDecision,
  relatedEntity: (name: string) => EntityAST | undefined,
  view?: (target: EntityAST, row: Record<string, unknown>) => Record<string, unknown>,
): Promise<Record<string, unknown>[]> {
  if (expand.length === 0 || rows.length === 0) {
    return rows;
  }
  const expansions: Record<string, Record<string, Record<string, unknown>>> = {};
  for (const fieldName of expand) {
    const field = entity.fieldMap[fieldName];
    const target = field?.relation?.to;
    if (!target) {
      continue;
    }
    const ids = [...new Set(rows.map((row) => row[fieldName]).filter((id): id is string => typeof id === "string"))];
    if (ids.length === 0) {
      expansions[fieldName] = {};
      continue;
    }
    const decision = relatedAccess(target);
    if (!decision.allow) {
      expansions[fieldName] = {};
      continue;
    }
    let qb = db.selectFrom(target).selectAll().where("id", "in", ids);
    qb = applyAccess(qb as unknown as QB, decision) as typeof qb;
    const related = await qb.execute();
    const targetEntity = relatedEntity(target);
    expansions[fieldName] = Object.fromEntries(
      related.map((item) => {
        const decoded = decodeRow(targetEntity ?? entity, item as Record<string, unknown>);
        if (targetEntity) {
          for (const field of targetEntity.fields) {
            if (field.secret) {
              delete decoded[field.name];
            }
          }
        }
        return [String(item.id), targetEntity && view ? view(targetEntity, decoded) : decoded];
      }),
    );
  }
  return rows.map((row) => {
    const $expand: Record<string, unknown> = {};
    for (const fieldName of expand) {
      const id = row[fieldName];
      $expand[fieldName] = typeof id === "string" ? (expansions[fieldName]?.[id] ?? null) : null;
    }
    return { ...row, $expand };
  });
}
