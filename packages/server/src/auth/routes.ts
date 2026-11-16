import { Hono } from "hono";
import { clientIp } from "../http/client-ip.ts";
import { encodeValue } from "../db/types.ts";
import { hashPassword, verifyPassword } from "./password.ts";
import { signAccessToken, verifyAccessToken } from "./jwt.ts";
import { issueRefreshToken, revokeAllForUser, revokeToken, rotateRefreshToken } from "./refresh.ts";
import { rateLimit } from "./rate-limit.ts";
import { runVerifyHook } from "../hooks/verify.ts";
import { clearLockout, getLockout, recordFailedLogin } from "./lockout.ts";
import { writeAudit } from "../audit/log.ts";
import { authTokenValid, retireAuthTokens } from "./tokens.ts";
import { publicRow } from "../crud/validate.ts";
import { decodeRow } from "../crud/query.ts";
import { sendVerificationEmail } from "./account.ts";
import { effectiveWritable, safeDefaultRole } from "../crud/write-guards.ts";
import { createFirstAdmin, hasAdmin } from "./seed.ts";
import { commitChange, recordChange } from "../events/record.ts";
import type { ChangeEvent } from "@bakorin/core";


export function createAuthRoutes(): Hono {
  const app = new Hono();

  app.get("/setup", async (c) => {
    const ctx = c.get("app");
    const firstAdmin = !(await hasAdmin(ctx.ast, ctx.db));
    return c.json({
      data: { firstAdmin, setupTokenRequired: firstAdmin && ctx.requireSetupToken === true, signup: ctx.ast.auth.signup },
    });
  });

  app.post("/first-admin", async (c) => {
    const ctx = c.get("app");
    const ip = clientIp(c);
    if (!(await rateLimit(ctx.db, `first-admin:${ip}`, 10, 60_000))) {
      return c.json({ error: { code: "rate_limited", message: "too many attempts" } }, 429);
    }
    const entity = ctx.ast.entityMap[ctx.ast.auth.entity];
    if (!entity) {
      return c.json({ error: { code: "misconfigured", message: "auth entity missing" } }, 500);
    }
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const identityField = entity.fieldMap[ctx.ast.auth.identityField];
    const identityRaw = String(body[ctx.ast.auth.identityField] ?? body.email ?? "").trim();
    const identity = identityField?.type === "email" ? identityRaw.toLowerCase() : identityRaw;
    const password = String(body[ctx.ast.auth.passwordField] ?? body.password ?? "");
    const name = typeof body.name === "string" ? body.name : undefined;
    if (!identity || password.length < 8) {
      return c.json(
        { error: { code: "invalid_input", message: "email and a password of at least 8 characters are required" } },
        400,
      );
    }
    if (ctx.requireSetupToken) {
      const setupToken = String(body.setupToken ?? c.req.header("x-bakorin-setup-token") ?? "").trim();
      if (!(await authTokenValid(ctx.db, setupToken, "setup"))) {
        await writeAudit(ctx.db, { action: "failed_first_admin", entity: entity.name, ip, meta: { reason: "setup_token" } });
        return c.json(
          {
            error: {
              code: "setup_token_required",
              message:
                "Enter the one time setup token from the server log, or set BAKORIN_ADMIN_EMAIL and BAKORIN_ADMIN_PASSWORD and restart.",
            },
          },
          403,
        );
      }
    }
    let result: Awaited<ReturnType<typeof createFirstAdmin>>;
    let createdEvent: ChangeEvent | null = null;
    const meta = { requestId: c.get("requestId"), ip };
    try {
      result = await createFirstAdmin(ctx.ast, ctx.db, { email: identity, password, name }, async (trx, id) => {
        const row = await trx.selectFrom(entity.name).selectAll().where("id", "=", id).executeTakeFirstOrThrow();
        const created = decodeRow(entity, row as Record<string, unknown>);
        const event: ChangeEvent = {
          entity: entity.name,
          op: "create",
          before: null,
          after: created,
          actor: { id, role: String(created[ctx.ast.auth.roleField]) },
        };
        await recordChange(trx, ctx, event, meta);
        createdEvent = event;
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "could not create admin";
      return c.json({ error: { code: "invalid_input", message } }, 400);
    }
    if (result.status === "exists") {
      return c.json({ error: { code: "conflict", message: "an admin already exists" } }, 409);
    }
    await retireAuthTokens(ctx.db, "setup");
    const stored = await ctx.db.selectFrom(entity.name).selectAll().where("id", "=", result.id).executeTakeFirstOrThrow();
    const after = decodeRow(entity, stored as Record<string, unknown>);
    const role = String(after[ctx.ast.auth.roleField]);
    if (createdEvent) {
      ctx.bus.emit(createdEvent, meta);
    }
    await writeAudit(ctx.db, {
      action: "first_admin",
      actorId: result.id,
      actorRole: role,
      entity: entity.name,
      recordId: result.id,
      ip,
    });
    const accessToken = await signAccessToken(
      { sub: result.id, role, ent: entity.name },
      ctx.ast.runtime.jwtSecret,
      ctx.ast.runtime.accessTtlSeconds,
    );
    const refreshToken = await issueRefreshToken(ctx.db, result.id, ctx.ast.runtime.refreshTtlSeconds);
    return c.json(
      { data: { user: publicRow(entity, after), accessToken, refreshToken, expiresIn: ctx.ast.runtime.accessTtlSeconds } },
      201,
    );
  });

  app.post("/signup", async (c) => {
    const ctx = c.get("app");
    const ip = clientIp(c);
    if (!(await rateLimit(ctx.db, `signup:${ip}`, 10, 60_000))) {
      return c.json({ error: { code: "rate_limited", message: "too many signup attempts" } }, 429);
    }
    if (ctx.ast.auth.signup !== "open") {
      return c.json(
        {
          error: {
            code: "signup_disabled",
            message:
              ctx.ast.auth.signup === "invite"
                ? "Signup is invite only for this app. Ask an admin to invite you."
                : "Signup is turned off for this app.",
          },
        },
        403,
      );
    }
    const entity = ctx.ast.entityMap[ctx.ast.auth.entity];
    if (!entity) {
      return c.json({ error: { code: "misconfigured", message: "auth entity missing" } }, 500);
    }
    const refused = await runVerifyHook(c, "signup", entity.name);
    if (refused) {
      return refused;
    }
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const identityField = entity.fieldMap[ctx.ast.auth.identityField];
    const identityRaw = String(body[ctx.ast.auth.identityField] ?? "").trim();
    const identity = identityField?.type === "email" ? identityRaw.toLowerCase() : identityRaw;
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
        insert[field.name] = safeDefaultRole(ctx.ast, field);
        continue;
      }
      if (field.name === "emailVerified") {
        insert[field.name] = encodeValue(ctx.ast.runtime.dialect, field, false);
        continue;
      }
      if (effectiveWritable(ctx.ast, entity, field) !== "any") {
        if (field.defaultValue !== undefined) {
          insert[field.name] = encodeValue(ctx.ast.runtime.dialect, field, field.defaultValue);
        }
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
    const after = await commitChange(ctx, { requestId: c.get("requestId"), ip }, async (trx) => {
      await trx.insertInto(entity.name).values(insert).execute();
      const stored = await trx.selectFrom(entity.name).selectAll().where("id", "=", id).executeTakeFirstOrThrow();
      const row = decodeRow(entity, stored as Record<string, unknown>);
      return {
        event: { entity: entity.name, op: "create", before: null, after: row, actor: { id, role: String(row[ctx.ast.auth.roleField]) } },
        result: row,
      };
    });
    await writeAudit(ctx.db, { action: "signup", actorId: id, actorRole: String(after[ctx.ast.auth.roleField]), entity: entity.name, recordId: id, ip });
    await sendVerificationEmail(ctx, id, identity);
    const role = String(after[ctx.ast.auth.roleField]);
    if (ctx.ast.auth.requireVerifiedEmail) {
      return c.json({ data: { user: publicRow(entity, after), needsVerification: true } }, 201);
    }
    const accessToken = await signAccessToken({ sub: id, role, ent: entity.name }, ctx.ast.runtime.jwtSecret, ctx.ast.runtime.accessTtlSeconds);
    const refreshToken = await issueRefreshToken(ctx.db, id, ctx.ast.runtime.refreshTtlSeconds);
    return c.json({ data: { user: publicRow(entity, after), accessToken, refreshToken, expiresIn: ctx.ast.runtime.accessTtlSeconds } }, 201);
  });

  app.post("/login", async (c) => {
    const ctx = c.get("app");
    const ip = clientIp(c);
    if (!(await rateLimit(ctx.db, `login:${ip}`, 10, 60_000))) {
      return c.json({ error: { code: "rate_limited", message: "too many login attempts" } }, 429);
    }
    const entity = ctx.ast.entityMap[ctx.ast.auth.entity]!;
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const identityField = entity.fieldMap[ctx.ast.auth.identityField];
    const identityRaw = String(body[ctx.ast.auth.identityField] ?? "").trim();
    const identity = identityField?.type === "email" ? identityRaw.toLowerCase() : identityRaw;
    const password = String(body[ctx.ast.auth.passwordField] ?? "");
    const lock = await getLockout(ctx.db, identity);
    if (lock.locked) {
      await writeAudit(ctx.db, { action: "failed_login", entity: entity.name, ip, meta: { identity, reason: "locked" } });
      return c.json({ error: { code: "locked", message: `account locked until ${lock.until}` } }, 429);
    }
    const row = await ctx.db.selectFrom(entity.name).selectAll().where(ctx.ast.auth.identityField, "=", identity).executeTakeFirst();
    if (!row) {
      await writeAudit(ctx.db, { action: "failed_login", entity: entity.name, ip, meta: { identity, reason: "unknown" } });
      return c.json({ error: { code: "unauthenticated", message: "invalid credentials" } }, 401);
    }
    const ok = await verifyPassword(password, String(row[ctx.ast.auth.passwordField] ?? ""));
    if (!ok) {
      const next = await recordFailedLogin(ctx.db, identity);
      await writeAudit(ctx.db, {
        action: "failed_login",
        actorId: String(row.id),
        entity: entity.name,
        recordId: String(row.id),
        ip,
        meta: { identity, locked: next.locked },
      });
      if (next.locked) {
        return c.json({ error: { code: "locked", message: `account locked until ${next.until}` } }, 429);
      }
      return c.json({ error: { code: "unauthenticated", message: "invalid credentials" } }, 401);
    }
    const user = decodeRow(entity, row as Record<string, unknown>);
    if (ctx.ast.auth.requireVerifiedEmail && user.emailVerified !== true) {
      return c.json({ error: { code: "email_unverified", message: "verify your email before signing in" } }, 403);
    }
    await clearLockout(ctx.db, identity);
    const role = String(user[ctx.ast.auth.roleField]);
    const accessToken = await signAccessToken(
      { sub: String(user.id), role, ent: entity.name },
      ctx.ast.runtime.jwtSecret,
      ctx.ast.runtime.accessTtlSeconds,
    );
    const refreshToken = await issueRefreshToken(ctx.db, String(user.id), ctx.ast.runtime.refreshTtlSeconds);
    await writeAudit(ctx.db, { action: "login", actorId: String(user.id), actorRole: role, entity: entity.name, recordId: String(user.id), ip });
    return c.json({ data: { user: publicRow(entity, user), accessToken, refreshToken, expiresIn: ctx.ast.runtime.accessTtlSeconds } });
  });

  app.post("/refresh", async (c) => {
    const ctx = c.get("app");
    const body = (await c.req.json().catch(() => ({}))) as { refreshToken?: string };
    const presented = body.refreshToken;
    if (!presented) {
      return c.json({ error: { code: "invalid_input", message: "refreshToken is required" } }, 400);
    }
    const rotated = await rotateRefreshToken(ctx.db, presented, ctx.ast.runtime.refreshTtlSeconds, {
      secrets: [ctx.ast.runtime.jwtSecret, ctx.ast.runtime.jwtSecretPrevious],
    });
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
