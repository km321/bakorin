import { Hono } from "hono";
import type { EntityAST, SchemaAST } from "@bakorin/core";
import type { Actor, AppContext } from "../context.ts";
import { encodeValue } from "../db/types.ts";
import { hashPassword } from "../auth/password.ts";
import { decideAccess, ownedByFields } from "./policies-sql.ts";
import { applyAccess, applyFilters, decodeRow, expandRows, parseListQuery } from "./query.ts";
import { InputError, parseBody, publicRow } from "./validate.ts";

function jsonError(code: string, message: string, status: number) {
  return Response.json({ error: { code, message } }, { status });
}

function entityOr404(ast: SchemaAST, name: string): EntityAST | null {
  return ast.entityMap[name] ?? null;
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
  if (forced.length === 0 || bypass) {
    return data;
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
  const result = await fn({ entity, record, before, actor, db: ctx.db });
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
    const query = parseListQuery(entity, new URL(c.req.url).searchParams);
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
    let decoded = rows.map((row) => publicRow(entity, decodeRow(entity, row as Record<string, unknown>)));
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
    let data = [publicRow(entity, decodeRow(entity, row as Record<string, unknown>))];
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
    const forced = ownedByFields(entity, ctx.ast.auth.entity);
    let body: Record<string, unknown>;
    try {
      body = parseBody(entity, (await c.req.json()) as Record<string, unknown>, "create", forced);
    } catch (error) {
      const message = error instanceof InputError ? error.message : "invalid body";
      return jsonError("invalid_input", message, 400);
    }
    body = stripClientOwnership(entity, ctx.ast.auth.entity, body, actor, decision.bypass, "create");
    body = await runBefore(ctx, entity.name, "beforeCreate", body, actor);
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
    await ctx.db.insertInto(entity.name).values(insert).execute();
    const stored = await ctx.db.selectFrom(entity.name).selectAll().where("id", "=", id).executeTakeFirstOrThrow();
    const after = decodeRow(entity, stored as Record<string, unknown>);
    ctx.bus.emit({ entity: entity.name, op: "create", before: null, after, actor: actor ? { id: actor.id, role: actor.role } : null });
    return c.json({ data: publicRow(entity, after) }, 201);
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
    let qb = ctx.db.selectFrom(entity.name).selectAll().where("id", "=", c.req.param("id"));
    qb = applyAccess(qb as never, decision) as typeof qb;
    const existing = await qb.executeTakeFirst();
    if (!existing) {
      return jsonError("not_found", "not found", 404);
    }
    let body: Record<string, unknown>;
    try {
      body = parseBody(entity, (await c.req.json()) as Record<string, unknown>, "update");
    } catch (error) {
      const message = error instanceof InputError ? error.message : "invalid body";
      return jsonError("invalid_input", message, 400);
    }
    body = stripClientOwnership(entity, ctx.ast.auth.entity, body, actor, decision.bypass, "update");
    const before = decodeRow(entity, existing as Record<string, unknown>);
    body = await runBefore(ctx, entity.name, "beforeUpdate", body, actor, before);
    const patch: Record<string, unknown> = { updatedAt: new Date().toISOString() };
    for (const [key, value] of Object.entries(body)) {
      const field = entity.fieldMap[key];
      if (!field) {
        continue;
      }
      patch[key] =
        field.type === "password" && typeof value === "string" ? await hashPassword(value) : encodeValue(ctx.ast.runtime.dialect, field, value);
    }
    await ctx.db.updateTable(entity.name).set(patch).where("id", "=", c.req.param("id")).execute();
    const stored = await ctx.db.selectFrom(entity.name).selectAll().where("id", "=", c.req.param("id")).executeTakeFirstOrThrow();
    const after = decodeRow(entity, stored as Record<string, unknown>);
    ctx.bus.emit({ entity: entity.name, op: "update", before, after, actor: actor ? { id: actor.id, role: actor.role } : null });
    return c.json({ data: publicRow(entity, after) });
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
    let qb = ctx.db.selectFrom(entity.name).selectAll().where("id", "=", c.req.param("id"));
    qb = applyAccess(qb as never, decision) as typeof qb;
    const existing = await qb.executeTakeFirst();
    if (!existing) {
      return jsonError("not_found", "not found", 404);
    }
    const before = decodeRow(entity, existing as Record<string, unknown>);
    await runBefore(ctx, entity.name, "beforeDelete", before, actor, before);
    await ctx.db.deleteFrom(entity.name).where("id", "=", c.req.param("id")).execute();
    ctx.bus.emit({ entity: entity.name, op: "delete", before, after: null, actor: actor ? { id: actor.id, role: actor.role } : null });
    return c.json({ data: { id: c.req.param("id") } });
  });

  return app;
}
