import { Hono } from "hono";
import { encodeValue } from "../db/types.ts";
import { hashPassword, verifyPassword } from "./password.ts";
import { signAccessToken, verifyAccessToken } from "./jwt.ts";
import { issueRefreshToken, revokeAllForUser, revokeToken, rotateRefreshToken } from "./refresh.ts";
import { rateLimit } from "./rate-limit.ts";
import { publicRow } from "../crud/validate.ts";
import { decodeRow } from "../crud/query.ts";

function clientKey(c: { req: { header: (name: string) => string | undefined } }): string {
  return c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || c.req.header("x-real-ip") || "local";
}

export function createAuthRoutes(): Hono {
  const app = new Hono();

  app.post("/signup", async (c) => {
    if (!rateLimit(`signup:${clientKey(c)}`, 10, 60_000)) {
      return c.json({ error: { code: "rate_limited", message: "too many signup attempts" } }, 429);
    }
    const ctx = c.get("app");
    const entity = ctx.ast.entityMap[ctx.ast.auth.entity];
    if (!entity) {
      return c.json({ error: { code: "misconfigured", message: "auth entity missing" } }, 500);
    }
    const body = (await c.req.json()) as Record<string, unknown>;
    const identity = String(body[ctx.ast.auth.identityField] ?? "");
    const password = String(body[ctx.ast.auth.passwordField] ?? "");
    if (!identity || password.length < 8) {
      return c.json({ error: { code: "invalid_input", message: "identity and a password of at least 8 characters are required" } }, 400);
    }
    const existing = await ctx.db
      .selectFrom(entity.name)
      .select("id")
      .where(ctx.ast.auth.identityField, "=", identity)
      .executeTakeFirst();
    if (existing) {
      return c.json({ error: { code: "conflict", message: "account already exists" } }, 409);
    }
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const insert: Record<string, unknown> = {
      id,
      createdAt: now,
      updatedAt: now,
    };
    for (const field of entity.fields) {
      if (field.name === "id" || field.name === "createdAt" || field.name === "updatedAt") {
        continue;
      }
      if (field.name === ctx.ast.auth.passwordField) {
        insert[field.name] = await hashPassword(password);
        continue;
      }
      if (field.name === ctx.ast.auth.roleField) {
        insert[field.name] = field.defaultValue ?? field.enumValues?.find((value) => value !== ctx.ast.auth.adminRole) ?? "user";
        continue;
      }
      if (field.name in body) {
        insert[field.name] = encodeValue(ctx.ast.runtime.dialect, field, body[field.name]);
      } else if (field.defaultValue !== undefined) {
        insert[field.name] = encodeValue(ctx.ast.runtime.dialect, field, field.defaultValue);
      } else if (field.required) {
        return c.json({ error: { code: "invalid_input", message: `${field.name} is required` } }, 400);
      }
    }
    await ctx.db.insertInto(entity.name).values(insert).execute();
    const stored = await ctx.db.selectFrom(entity.name).selectAll().where("id", "=", id).executeTakeFirstOrThrow();
    const after = decodeRow(entity, stored as Record<string, unknown>);
    ctx.bus.emit({ entity: entity.name, op: "create", before: null, after, actor: { id, role: String(after[ctx.ast.auth.roleField]) } });
    const role = String(after[ctx.ast.auth.roleField]);
    const accessToken = await signAccessToken({ sub: id, role, ent: entity.name }, ctx.ast.runtime.jwtSecret, ctx.ast.runtime.accessTtlSeconds);
    const refreshToken = await issueRefreshToken(ctx.db, id, ctx.ast.runtime.refreshTtlSeconds);
    return c.json({ data: { user: publicRow(entity, after), accessToken, refreshToken, expiresIn: ctx.ast.runtime.accessTtlSeconds } }, 201);
  });

  app.post("/login", async (c) => {
    if (!rateLimit(`login:${clientKey(c)}`, 10, 60_000)) {
      return c.json({ error: { code: "rate_limited", message: "too many login attempts" } }, 429);
    }
    const ctx = c.get("app");
    const entity = ctx.ast.entityMap[ctx.ast.auth.entity]!;
    const body = (await c.req.json()) as Record<string, unknown>;
    const identity = String(body[ctx.ast.auth.identityField] ?? "");
    const password = String(body[ctx.ast.auth.passwordField] ?? "");
    const row = await ctx.db.selectFrom(entity.name).selectAll().where(ctx.ast.auth.identityField, "=", identity).executeTakeFirst();
    if (!row) {
      return c.json({ error: { code: "unauthenticated", message: "invalid credentials" } }, 401);
    }
    const ok = await verifyPassword(password, String(row[ctx.ast.auth.passwordField] ?? ""));
    if (!ok) {
      return c.json({ error: { code: "unauthenticated", message: "invalid credentials" } }, 401);
    }
    const user = decodeRow(entity, row as Record<string, unknown>);
    const role = String(user[ctx.ast.auth.roleField]);
    const accessToken = await signAccessToken(
      { sub: String(user.id), role, ent: entity.name },
      ctx.ast.runtime.jwtSecret,
      ctx.ast.runtime.accessTtlSeconds,
    );
    const refreshToken = await issueRefreshToken(ctx.db, String(user.id), ctx.ast.runtime.refreshTtlSeconds);
    return c.json({ data: { user: publicRow(entity, user), accessToken, refreshToken, expiresIn: ctx.ast.runtime.accessTtlSeconds } });
  });

  app.post("/refresh", async (c) => {
    const ctx = c.get("app");
    const body = (await c.req.json().catch(() => ({}))) as { refreshToken?: string };
    const presented = body.refreshToken;
    if (!presented) {
      return c.json({ error: { code: "invalid_input", message: "refreshToken is required" } }, 400);
    }
    const rotated = await rotateRefreshToken(ctx.db, presented, ctx.ast.runtime.refreshTtlSeconds);
    if (!rotated) {
      return c.json({ error: { code: "unauthenticated", message: "invalid refresh token" } }, 401);
    }
    if ("reuse" in rotated) {
      return c.json({ error: { code: "unauthenticated", message: "refresh token reuse detected" } }, 401);
    }
    const entity = ctx.ast.entityMap[ctx.ast.auth.entity]!;
    const row = await ctx.db.selectFrom(entity.name).selectAll().where("id", "=", rotated.userId).executeTakeFirst();
    if (!row) {
      return c.json({ error: { code: "unauthenticated", message: "user missing" } }, 401);
    }
    const user = decodeRow(entity, row as Record<string, unknown>);
    const accessToken = await signAccessToken(
      { sub: rotated.userId, role: String(user[ctx.ast.auth.roleField]), ent: entity.name },
      ctx.ast.runtime.jwtSecret,
      ctx.ast.runtime.accessTtlSeconds,
    );
    return c.json({ data: { accessToken, refreshToken: rotated.token, expiresIn: ctx.ast.runtime.accessTtlSeconds } });
  });

  app.post("/logout", async (c) => {
    const ctx = c.get("app");
    const body = (await c.req.json().catch(() => ({}))) as { refreshToken?: string; all?: boolean };
    if (body.all) {
      const actor = c.get("actor");
      if (!actor) {
        return c.json({ error: { code: "unauthenticated", message: "sign in required" } }, 401);
      }
      await revokeAllForUser(ctx.db, actor.id);
      return c.json({ data: { ok: true } });
    }
    if (body.refreshToken) {
      await revokeToken(ctx.db, body.refreshToken);
    }
    return c.json({ data: { ok: true } });
  });

  app.get("/me", async (c) => {
    const actor = c.get("actor");
    if (!actor) {
      return c.json({ error: { code: "unauthenticated", message: "sign in required" } }, 401);
    }
    const ctx = c.get("app");
    const entity = ctx.ast.entityMap[ctx.ast.auth.entity]!;
    const row = await ctx.db.selectFrom(entity.name).selectAll().where("id", "=", actor.id).executeTakeFirst();
    if (!row) {
      return c.json({ error: { code: "not_found", message: "user missing" } }, 404);
    }
    return c.json({ data: publicRow(entity, decodeRow(entity, row as Record<string, unknown>)) });
  });

  return app;
}

export { verifyAccessToken };
