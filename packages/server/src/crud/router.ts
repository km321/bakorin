import { Hono } from "hono";
import type { EntityAST, SchemaAST } from "@bakorin/core";
import type { Actor, AppContext } from "../context.ts";
import { encodeValue } from "../db/types.ts";
import { hashPassword } from "../auth/password.ts";
import { revokeAllForUser } from "../auth/refresh.ts";
import { commitChange } from "../events/record.ts";
import { clientIp } from "../http/client-ip.ts";
import { checkRateRule, rateLimitedResponse } from "../auth/rate-limit.ts";
import { runVerifyHook } from "../hooks/verify.ts";
import type { ChangeMeta } from "../bus.ts";
import type { Context } from "hono";
import { decideAccess, ownedByFields } from "./policies-sql.ts";
import { applyAccess, applyFilters, decodeRow, expandRows, parseListQuery } from "./query.ts";
import { InputError, parseBody, visibleRow } from "./validate.ts";
import {
  applyAuthCreateDefaults,
  assertClientFieldWrites,
  assertPasswordWrite,
  ForbiddenError,
  stripDisallowedWrites,
} from "./write-guards.ts";

function jsonError(code: string, message: string, status: number) {
  return Response.json({ error: { code, message } }, { status });
}

function changeMeta(c: Context): ChangeMeta {
  return { requestId: c.get("requestId"), ip: clientIp(c) };
}

function actorRef(actor: Actor | null): { id: string; role: string } | null {
  return actor ? { id: actor.id, role: actor.role } : null;
}

/**
 * A client may only point a relation at a record it can read. A missing id and an
 * unreadable one get the same 400, so ids cannot be probed. Fields set only by a
 * before hook, and ownership fields stamped from the session, are trusted.
 */
async function assertRelationTargets(
  ctx: AppContext,
  entity: EntityAST,
  raw: Record<string, unknown>,
  body: Record<string, unknown>,
  actor: Actor | null,
): Promise<string | null> {
  for (const field of entity.fields) {
    const to = field.relation?.to;
    if (field.type !== "relation" || !to || !(field.name in raw)) {
      continue;
    }
    const value = body[field.name];
    if (value === undefined || value === null || value === "") {
      continue;
    }
    if (actor && to === ctx.ast.auth.entity && String(value) === actor.id) {
      continue;
    }
    const target = ctx.ast.entityMap[to];
    if (!target) {
      continue;
    }
    const decision = decideAccess(ctx.ast, target, "read", actor);
    let found = false;
    if (decision.allow) {
      let qb = ctx.db.selectFrom(target.name).select("id").where("id", "=", String(value));
      qb = applyAccess(qb as never, decision) as typeof qb;
      found = Boolean(await qb.executeTakeFirst());
    }
    if (!found) {
      return `${field.name} must reference a ${target.name} record that exists and that you can read`;
    }
  }
  return null;
}

/** Per entity rateLimit from app.yaml. Null when the request may continue. */
async function entityRateLimit(
  c: Context,
  entity: EntityAST,
  action: "read" | "create" | "update" | "delete",
  actor: Actor | null,
): Promise<Response | null> {
  const rule = entity.rateLimit?.[action];
  if (!rule) {
    return null;
  }
  const ctx = c.get("app");
  const allowed = await checkRateRule(ctx.db, `crud:${entity.name}:${action}`, rule, clientIp(c), actor?.id ?? null);
  return allowed ? null : rateLimitedResponse(rule, `too many ${action} requests for ${entity.name}`);
}

function entityOr404(ast: SchemaAST, name: string): EntityAST | null {
  return ast.entityMap[name] ?? null;
}

function ownershipMissing(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}

function stripClientOwnership(
  entity: EntityAST,
  authEntity: string,
  data: Record<string, unknown>,
  actor: Actor | null,
  bypass: boolean,
  action: "create" | "update",
): Record<string, unknown> {
  const forced = ownedByFields(entity, authEntity);
  if (forced.length === 0) {
    return data;
  }
  if (bypass) {
    if (action !== "create" || !actor) {
      return data;
    }
    const next = { ...data };
    for (const field of forced) {
      if (ownershipMissing(next[field])) {
        next[field] = actor.id;
      }
    }
    return next;
  }
  const next = { ...data };
  for (const field of forced) {
    if (action === "update") {
      delete next[field];
      continue;
    }
    if (actor) {
      next[field] = actor.id;
    } else {
      delete next[field];
    }
  }
  return next;
}

async function runBefore(
  ctx: AppContext,
  entity: string,
  hook: "beforeCreate" | "beforeUpdate" | "beforeDelete",
  record: Record<string, unknown>,
  actor: Actor | null,
  before?: Record<string, unknown> | null,
): Promise<Record<string, unknown>> {
  const fn = ctx.hooks.entities?.[entity]?.[hook];
  if (!fn) {
    return record;
  }
  const result = await fn({ entity, record, before, actor, db: ctx.db, mail: ctx.mail });
  return hook === "beforeDelete" ? record : ((result as Record<string, unknown> | undefined) ?? record);
}

export function createCrudRouter(): Hono {
  const app = new Hono();

  app.get("/:entity", async (c) => {
    const ctx = c.get("app");
    const entity = entityOr404(ctx.ast, c.req.param("entity"));
    if (!entity) {
      return jsonError("not_found", "unknown entity", 404);
    }
    const actor = c.get("actor");
    const decision = decideAccess(ctx.ast, entity, "read", actor);
    if (!decision.allow) {
      return jsonError(decision.status === 401 ? "unauthenticated" : "forbidden", "not allowed", decision.status);
    }
    const limited = await entityRateLimit(c, entity, "read", actor);
    if (limited) {
      return limited;
    }
    const privateAllowed = Boolean(actor && actor.role === ctx.ast.auth.adminRole);
    const query = parseListQuery(entity, new URL(c.req.url).searchParams, { privateAllowed });
    let qb = ctx.db.selectFrom(entity.name).selectAll();
    qb = applyFilters(qb as never, entity, query, ctx.ast.runtime.dialect) as typeof qb;
    qb = applyAccess(qb as never, decision) as typeof qb;
    let countQb = ctx.db.selectFrom(entity.name).select(ctx.db.fn.countAll().as("count"));
    countQb = applyFilters(countQb as never, entity, query, ctx.ast.runtime.dialect) as typeof countQb;
    countQb = applyAccess(countQb as never, decision) as typeof countQb;
    const totalRow = await countQb.executeTakeFirst();
    for (const sort of query.sort) {
      qb = qb.orderBy(sort.field, sort.dir);
    }
    const rows = await qb.limit(query.limit).offset(query.offset).execute();
    const view = (target: EntityAST, row: Record<string, unknown>) => visibleRow(ctx.ast, target, row, actor);
    let decoded = rows.map((row) => view(entity, decodeRow(entity, row as Record<string, unknown>)));
    decoded = await expandRows(
      ctx.db,
      entity,
      decoded,
      query.expand,
      (name) => {
        const related = ctx.ast.entityMap[name];
        if (!related) {
          return { allow: false, status: 403, ownerFields: [], actorId: null, bypass: false };
        }
        return decideAccess(ctx.ast, related, "read", actor);
      },
      (name) => ctx.ast.entityMap[name],
      view,
    );
    const total = Number((totalRow as { count?: number | string } | undefined)?.count ?? decoded.length);
    return c.json({ data: decoded, meta: { total, limit: query.limit, offset: query.offset } });
  });

  app.get("/:entity/:id", async (c) => {
    const ctx = c.get("app");
    const entity = entityOr404(ctx.ast, c.req.param("entity"));
    if (!entity) {
      return jsonError("not_found", "unknown entity", 404);
    }
    const actor = c.get("actor");
    const decision = decideAccess(ctx.ast, entity, "read", actor);
    if (!decision.allow) {
      return jsonError(decision.status === 401 ? "unauthenticated" : "forbidden", "not allowed", decision.status);
    }
    const limited = await entityRateLimit(c, entity, "read", actor);
    if (limited) {
      return limited;
    }
    let qb = ctx.db.selectFrom(entity.name).selectAll().where("id", "=", c.req.param("id"));
    qb = applyAccess(qb as never, decision) as typeof qb;
    const row = await qb.executeTakeFirst();
    if (!row) {
      return jsonError("not_found", "not found", 404);
    }
    const expand = (new URL(c.req.url).searchParams.get("expand") ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    const view = (target: EntityAST, item: Record<string, unknown>) => visibleRow(ctx.ast, target, item, actor);
    let data = [view(entity, decodeRow(entity, row as Record<string, unknown>))];
    data = await expandRows(
      ctx.db,
      entity,
      data,
      expand,
      (name) => {
        const related = ctx.ast.entityMap[name];
        if (!related) {
          return { allow: false, status: 403, ownerFields: [], actorId: null, bypass: false };
        }
        return decideAccess(ctx.ast, related, "read", actor);
      },
      (name) => ctx.ast.entityMap[name],
      view,
    );
    return c.json({ data: data[0] });
  });

  app.post("/:entity", async (c) => {
    const ctx = c.get("app");
    const entity = entityOr404(ctx.ast, c.req.param("entity"));
    if (!entity) {
      return jsonError("not_found", "unknown entity", 404);
    }
    const actor = c.get("actor");
    const decision = decideAccess(ctx.ast, entity, "create", actor);
    if (!decision.allow) {
      return jsonError(decision.status === 401 ? "unauthenticated" : "forbidden", "not allowed", decision.status);
    }
    const limited = await entityRateLimit(c, entity, "create", actor);
    if (limited) {
      return limited;
    }
    if (!actor) {
      const refused = await runVerifyHook(c, "create", entity.name);
      if (refused) {
        return refused;
      }
    }
    const forced = ownedByFields(entity, ctx.ast.auth.entity);
    let raw: Record<string, unknown>;
    let body: Record<string, unknown>;
    try {
      raw = (await c.req.json()) as Record<string, unknown>;
      assertClientFieldWrites(ctx.ast, entity, raw, actor, forced, "create");
      body = parseBody(entity, raw, "create", forced);
      applyAuthCreateDefaults(ctx.ast, entity, body, actor);
      await assertPasswordWrite(ctx.ast, entity, body, raw, actor, null);
    } catch (error) {
      if (error instanceof ForbiddenError) {
        return jsonError("forbidden", error.message, 403);
      }
      const message = error instanceof InputError ? error.message : "invalid body";
      return jsonError("invalid_input", message, 400);
    }
    body = stripClientOwnership(entity, ctx.ast.auth.entity, body, actor, decision.bypass, "create");
    body = await runBefore(ctx, entity.name, "beforeCreate", body, actor);
    body = stripDisallowedWrites(ctx.ast, entity, body, actor);
    body = stripClientOwnership(entity, ctx.ast.auth.entity, body, actor, decision.bypass, "create");
    const badRelation = await assertRelationTargets(ctx, entity, raw, body, actor);
    if (badRelation) {
      return jsonError("invalid_input", badRelation, 400);
    }
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const insert: Record<string, unknown> = { id, createdAt: now, updatedAt: now };
    for (const [key, value] of Object.entries(body)) {
      const field = entity.fieldMap[key];
      if (!field) {
        continue;
      }
      insert[key] =
        field.type === "password" && typeof value === "string" ? await hashPassword(value) : encodeValue(ctx.ast.runtime.dialect, field, value);
    }
    const after = await commitChange(ctx, changeMeta(c), async (trx) => {
      await trx.insertInto(entity.name).values(insert).execute();
      const stored = await trx.selectFrom(entity.name).selectAll().where("id", "=", id).executeTakeFirstOrThrow();
      const row = decodeRow(entity, stored as Record<string, unknown>);
      return { event: { entity: entity.name, op: "create", before: null, after: row, actor: actorRef(actor) }, result: row };
    });
    return c.json({ data: visibleRow(ctx.ast, entity, after, actor) }, 201);
  });

  app.patch("/:entity/:id", async (c) => {
    const ctx = c.get("app");
    const entity = entityOr404(ctx.ast, c.req.param("entity"));
    if (!entity) {
      return jsonError("not_found", "unknown entity", 404);
    }
    const actor = c.get("actor");
    const decision = decideAccess(ctx.ast, entity, "update", actor);
    if (!decision.allow) {
      return jsonError(decision.status === 401 ? "unauthenticated" : "forbidden", "not allowed", decision.status);
    }
    const limited = await entityRateLimit(c, entity, "update", actor);
    if (limited) {
      return limited;
    }
    let qb = ctx.db.selectFrom(entity.name).selectAll().where("id", "=", c.req.param("id"));
    qb = applyAccess(qb as never, decision) as typeof qb;
    const existing = await qb.executeTakeFirst();
    if (!existing) {
      return jsonError("not_found", "not found", 404);
    }
    const forced = ownedByFields(entity, ctx.ast.auth.entity);
    let raw: Record<string, unknown>;
    let body: Record<string, unknown>;
    let passwordChanged = false;
    const before = decodeRow(entity, existing as Record<string, unknown>);
    try {
      raw = (await c.req.json()) as Record<string, unknown>;
      assertClientFieldWrites(ctx.ast, entity, raw, actor, forced, "update");
      body = parseBody(entity, raw, "update");
      passwordChanged = await assertPasswordWrite(ctx.ast, entity, body, raw, actor, before);
    } catch (error) {
      if (error instanceof ForbiddenError) {
        return jsonError("forbidden", error.message, 403);
      }
      const message = error instanceof InputError ? error.message : "invalid body";
      return jsonError("invalid_input", message, 400);
    }
    body = stripClientOwnership(entity, ctx.ast.auth.entity, body, actor, decision.bypass, "update");
    body = await runBefore(ctx, entity.name, "beforeUpdate", body, actor, before);
    body = stripDisallowedWrites(ctx.ast, entity, body, actor);
    body = stripClientOwnership(entity, ctx.ast.auth.entity, body, actor, decision.bypass, "update");
    const badRelation = await assertRelationTargets(ctx, entity, raw, body, actor);
    if (badRelation) {
      return jsonError("invalid_input", badRelation, 400);
    }
    const patch: Record<string, unknown> = { updatedAt: new Date().toISOString() };
    for (const [key, value] of Object.entries(body)) {
      const field = entity.fieldMap[key];
      if (!field) {
        continue;
      }
      patch[key] =
        field.type === "password" && typeof value === "string" ? await hashPassword(value) : encodeValue(ctx.ast.runtime.dialect, field, value);
    }
    const recordId = c.req.param("id");
    const after = await commitChange(ctx, changeMeta(c), async (trx) => {
      await trx.updateTable(entity.name).set(patch).where("id", "=", recordId).execute();
      const stored = await trx.selectFrom(entity.name).selectAll().where("id", "=", recordId).executeTakeFirstOrThrow();
      const row = decodeRow(entity, stored as Record<string, unknown>);
      const roleChanged =
        entity.name === ctx.ast.auth.entity &&
        ctx.ast.auth.roleField in body &&
        String(before[ctx.ast.auth.roleField]) !== String(row[ctx.ast.auth.roleField]);
      if (passwordChanged || roleChanged) {
        await revokeAllForUser(trx, String(row.id));
      }
      return { event: { entity: entity.name, op: "update", before, after: row, actor: actorRef(actor) }, result: row };
    });
    return c.json({ data: visibleRow(ctx.ast, entity, after, actor) });
  });

  app.delete("/:entity/:id", async (c) => {
    const ctx = c.get("app");
    const entity = entityOr404(ctx.ast, c.req.param("entity"));
    if (!entity) {
      return jsonError("not_found", "unknown entity", 404);
    }
    const actor = c.get("actor");
    const decision = decideAccess(ctx.ast, entity, "delete", actor);
    if (!decision.allow) {
      return jsonError(decision.status === 401 ? "unauthenticated" : "forbidden", "not allowed", decision.status);
    }
    const limited = await entityRateLimit(c, entity, "delete", actor);
    if (limited) {
      return limited;
    }
    let qb = ctx.db.selectFrom(entity.name).selectAll().where("id", "=", c.req.param("id"));
    qb = applyAccess(qb as never, decision) as typeof qb;
    const existing = await qb.executeTakeFirst();
    if (!existing) {
      return jsonError("not_found", "not found", 404);
    }
    const before = decodeRow(entity, existing as Record<string, unknown>);
    await runBefore(ctx, entity.name, "beforeDelete", before, actor, before);
    const recordId = c.req.param("id");
    await commitChange(ctx, changeMeta(c), async (trx) => {
      await trx.deleteFrom(entity.name).where("id", "=", recordId).execute();
      return { event: { entity: entity.name, op: "delete", before, after: null, actor: actorRef(actor) }, result: null };
    });
    return c.json({ data: { id: c.req.param("id") } });
  });

  return app;
}
