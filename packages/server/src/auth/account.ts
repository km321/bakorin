import { Hono } from "hono";
import type { SchemaAST } from "@bakorin/core";
import { encodeValue } from "../db/types.ts";
import type { BakorinDb } from "../db/dialects.ts";
import { hashPassword } from "./password.ts";
import { signAccessToken } from "./jwt.ts";
import { issueRefreshToken, newToken, revokeAllForUser } from "./refresh.ts";
import { rateLimit } from "./rate-limit.ts";
import { writeAudit } from "../audit/log.ts";
import { accountLink, consumeAuthToken, issueAuthToken } from "./tokens.ts";
import { renderAccountEmail } from "../mail/templates.ts";
import type { Mailer, MailMessage } from "../mail/types.ts";
import { publicRow } from "../crud/validate.ts";
import { decodeRow } from "../crud/query.ts";
import { requireAdmin } from "./guard.ts";
import { safeDefaultRole } from "../crud/write-guards.ts";

function clientKey(c: { req: { header: (name: string) => string | undefined } }): string {
  return c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || c.req.header("x-real-ip") || "local";
}

async function sendQuietly(mailer: Mailer, message: MailMessage): Promise<void> {
  try {
    await mailer.send(message);
  } catch (error) {
    console.error("[bakorin] mail send failed", error instanceof Error ? error.message : error);
  }
}

export function createAccountRoutes(): Hono {
  const app = new Hono();

  app.post("/forgot-password", async (c) => {
    const ctx = c.get("app");
    const ip = clientKey(c);
    if (!(await rateLimit(ctx.db, `forgot:${ip}`, 5, 60 * 60 * 1000))) {
      return c.json({ error: { code: "rate_limited", message: "too many reset requests" } }, 429);
    }
    const body = (await c.req.json().catch(() => ({}))) as { email?: string };
    const email = String(body.email ?? "").trim().toLowerCase();
    const ok = { data: { ok: true } };
    if (!email) {
      return c.json(ok);
    }
    const entity = ctx.ast.entityMap[ctx.ast.auth.entity]!;
    const row = await ctx.db.selectFrom(entity.name).selectAll().where(ctx.ast.auth.identityField, "=", email).executeTakeFirst();
    if (!row) {
      return c.json(ok);
    }
    const token = await issueAuthToken(ctx.db, {
      userId: String(row.id),
      email,
      purpose: "reset",
      ttlSeconds: 60 * 60,
    });
    const link = accountLink(ctx.ast.runtime.appUrl, "/reset-password", token);
    const rendered = renderAccountEmail("reset", { appName: ctx.ast.appName, link });
    await sendQuietly(ctx.mailer, { to: email, ...rendered, meta: { purpose: "reset", token, link } });
    return c.json(ok);
  });

  app.post("/reset-password", async (c) => {
    const ctx = c.get("app");
    const body = (await c.req.json().catch(() => ({}))) as { token?: string; password?: string };
    const token = String(body.token ?? "");
    const password = String(body.password ?? "");
    if (!token || password.length < 8) {
      return c.json({ error: { code: "invalid_input", message: "token and a password of at least 8 characters are required" } }, 400);
    }
    const consumed = await consumeAuthToken(ctx.db, token, "reset");
    if (!consumed?.userId) {
      return c.json({ error: { code: "invalid_input", message: "invalid or expired token" } }, 400);
    }
    const entity = ctx.ast.entityMap[ctx.ast.auth.entity]!;
    const hashed = await hashPassword(password);
    await ctx.db
      .updateTable(entity.name)
      .set({ [ctx.ast.auth.passwordField]: hashed, updatedAt: new Date().toISOString() })
      .where("id", "=", consumed.userId)
      .execute();
    await revokeAllForUser(ctx.db, consumed.userId);
    await writeAudit(ctx.db, {
      action: "reset_password",
      actorId: consumed.userId,
      entity: entity.name,
      recordId: consumed.userId,
      ip: clientKey(c),
    });
    return c.json({ data: { ok: true } });
  });

  app.post("/verify-email", async (c) => {
    const ctx = c.get("app");
    const body = (await c.req.json().catch(() => ({}))) as { token?: string };
    const token = String(body.token ?? "");
    if (!token) {
      return c.json({ error: { code: "invalid_input", message: "token is required" } }, 400);
    }
    const consumed = await consumeAuthToken(ctx.db, token, "verify");
    if (!consumed?.userId) {
      return c.json({ error: { code: "invalid_input", message: "invalid or expired token" } }, 400);
    }
    const entity = ctx.ast.entityMap[ctx.ast.auth.entity]!;
    if (entity.fieldMap.emailVerified) {
      await ctx.db
        .updateTable(entity.name)
        .set({
          emailVerified: encodeValue(ctx.ast.runtime.dialect, entity.fieldMap.emailVerified, true),
          updatedAt: new Date().toISOString(),
        })
        .where("id", "=", consumed.userId)
        .execute();
    }
    return c.json({ data: { ok: true } });
  });

  app.post("/resend-verification", async (c) => {
    const ctx = c.get("app");
    if (!(await rateLimit(ctx.db, `reverify:${clientKey(c)}`, 5, 60 * 60 * 1000))) {
      return c.json({ error: { code: "rate_limited", message: "too many verification emails" } }, 429);
    }
    const actor = c.get("actor");
    const body = (await c.req.json().catch(() => ({}))) as { userId?: string; email?: string };
    const entity = ctx.ast.entityMap[ctx.ast.auth.entity]!;
    const admin = actor?.role === ctx.ast.auth.adminRole;
    let userId: string | undefined;
    if (typeof body.userId === "string" && body.userId) {
      if (!admin) {
        return c.json({ error: { code: "forbidden", message: "admin only" } }, 403);
      }
      userId = body.userId;
    } else if (actor) {
      userId = actor.id;
    } else if (typeof body.email === "string" && body.email) {
      const row = await ctx.db
        .selectFrom(entity.name)
        .select("id")
        .where(ctx.ast.auth.identityField, "=", body.email.trim().toLowerCase())
        .executeTakeFirst();
      userId = row ? String(row.id) : undefined;
    } else {
      return c.json({ error: { code: "unauthenticated", message: "sign in required" } }, 401);
    }
    const ok = { data: { ok: true } };
    if (!userId) {
      return c.json(ok);
    }
    const row = await ctx.db.selectFrom(entity.name).selectAll().where("id", "=", userId).executeTakeFirst();
    if (!row) {
      return c.json(ok);
    }
    const email = String(row[ctx.ast.auth.identityField] ?? "");
    const token = await issueAuthToken(ctx.db, { userId, email, purpose: "verify", ttlSeconds: 60 * 60 * 24 });
    const link = accountLink(ctx.ast.runtime.appUrl, "/verify-email", token);
    const rendered = renderAccountEmail("verify", { appName: ctx.ast.appName, link });
    await sendQuietly(ctx.mailer, { to: email, ...rendered, meta: { purpose: "verify", token, link } });
    return c.json(ok);
  });

  app.post("/invites", async (c) => {
    const denied = requireAdmin(c);
    if (denied) {
      return denied;
    }
    const ctx = c.get("app");
    const entity = ctx.ast.entityMap[ctx.ast.auth.entity]!;
    const body = (await c.req.json().catch(() => ({}))) as { email?: string; role?: string; name?: string };
    const email = String(body.email ?? "").trim().toLowerCase();
    if (!email) {
      return c.json({ error: { code: "invalid_input", message: "email is required" } }, 400);
    }
    const existing = await ctx.db.selectFrom(entity.name).select("id").where(ctx.ast.auth.identityField, "=", email).executeTakeFirst();
    if (existing) {
      return c.json({ error: { code: "conflict", message: "account already exists" } }, 409);
    }
    const roleField = entity.fieldMap[ctx.ast.auth.roleField]!;
    let role = typeof body.role === "string" && body.role ? body.role : safeDefaultRole(ctx.ast, roleField);
    if (!roleField.enumValues?.includes(role)) {
      return c.json({ error: { code: "invalid_input", message: `role must be one of ${roleField.enumValues?.join(", ")}` } }, 400);
    }
    const name = String(body.name ?? email.split("@")[0] ?? "Invited");
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const insert: Record<string, unknown> = { id, createdAt: now, updatedAt: now };
    for (const field of entity.fields) {
      if (field.name === "id" || field.name === "createdAt" || field.name === "updatedAt") {
        continue;
      }
      if (field.name === ctx.ast.auth.passwordField) {
        insert[field.name] = await hashPassword(newToken());
        continue;
      }
      if (field.name === ctx.ast.auth.identityField) {
        insert[field.name] = encodeValue(ctx.ast.runtime.dialect, field, email);
        continue;
      }
      if (field.name === ctx.ast.auth.roleField) {
        insert[field.name] = encodeValue(ctx.ast.runtime.dialect, field, role);
        continue;
      }
      if (field.name === "name") {
        insert[field.name] = encodeValue(ctx.ast.runtime.dialect, field, name);
        continue;
      }
      if (field.name === "emailVerified") {
        insert[field.name] = encodeValue(ctx.ast.runtime.dialect, field, true);
        continue;
      }
      if (field.defaultValue !== undefined) {
        insert[field.name] = encodeValue(ctx.ast.runtime.dialect, field, field.defaultValue);
        continue;
      }
      if (field.required) {
        return c.json({ error: { code: "invalid_input", message: `${field.name} is required` } }, 400);
      }
    }
    await ctx.db.insertInto(entity.name).values(insert).execute();
    const stored = await ctx.db.selectFrom(entity.name).selectAll().where("id", "=", id).executeTakeFirstOrThrow();
    const after = decodeRow(entity, stored as Record<string, unknown>);
    ctx.bus.emit({ entity: entity.name, op: "create", before: null, after, actor: c.get("actor") });
    const token = await issueAuthToken(ctx.db, {
      userId: id,
      email,
      purpose: "invite",
      ttlSeconds: 60 * 60 * 24 * 7,
      payload: { role, name },
    });
    const link = accountLink(ctx.ast.runtime.appUrl, "/accept-invite", token);
    const rendered = renderAccountEmail("invite", { appName: ctx.ast.appName, link });
    await sendQuietly(ctx.mailer, { to: email, ...rendered, meta: { purpose: "invite", token, link } });
    const actor = c.get("actor");
    await writeAudit(ctx.db, {
      action: "invite",
      actorId: actor?.id,
      actorRole: actor?.role,
      entity: entity.name,
      recordId: id,
      ip: clientKey(c),
      meta: { email, role },
    });
    return c.json({ data: { user: publicRow(entity, after), email, role } }, 201);
  });

  app.post("/accept-invite", async (c) => {
    const ctx = c.get("app");
    const body = (await c.req.json().catch(() => ({}))) as { token?: string; password?: string; name?: string };
    const token = String(body.token ?? "");
    const password = String(body.password ?? "");
    if (!token || password.length < 8) {
      return c.json({ error: { code: "invalid_input", message: "token and a password of at least 8 characters are required" } }, 400);
    }
    const consumed = await consumeAuthToken(ctx.db, token, "invite");
    if (!consumed?.userId) {
      return c.json({ error: { code: "invalid_input", message: "invalid or expired token" } }, 400);
    }
    const entity = ctx.ast.entityMap[ctx.ast.auth.entity]!;
    const patch: Record<string, unknown> = {
      [ctx.ast.auth.passwordField]: await hashPassword(password),
      updatedAt: new Date().toISOString(),
    };
    if (typeof body.name === "string" && body.name && entity.fieldMap.name) {
      patch.name = encodeValue(ctx.ast.runtime.dialect, entity.fieldMap.name, body.name);
    }
    await ctx.db.updateTable(entity.name).set(patch).where("id", "=", consumed.userId).execute();
    await revokeAllForUser(ctx.db, consumed.userId);
    const stored = await ctx.db.selectFrom(entity.name).selectAll().where("id", "=", consumed.userId).executeTakeFirst();
    if (!stored) {
      return c.json({ error: { code: "not_found", message: "user missing" } }, 404);
    }
    const user = decodeRow(entity, stored as Record<string, unknown>);
    const role = String(user[ctx.ast.auth.roleField]);
    const accessToken = await signAccessToken(
      { sub: consumed.userId, role, ent: entity.name },
      ctx.ast.runtime.jwtSecret,
      ctx.ast.runtime.accessTtlSeconds,
    );
    const refreshToken = await issueRefreshToken(ctx.db, consumed.userId, ctx.ast.runtime.refreshTtlSeconds);
    return c.json({
      data: { user: publicRow(entity, user), accessToken, refreshToken, expiresIn: ctx.ast.runtime.accessTtlSeconds },
    });
  });

  return app;
}

export async function sendVerificationEmail(
  ctx: { ast: SchemaAST; db: BakorinDb; mailer: Mailer },
  userId: string,
  email: string,
): Promise<void> {
  const token = await issueAuthToken(ctx.db, { userId, email, purpose: "verify", ttlSeconds: 60 * 60 * 24 });
  const link = accountLink(ctx.ast.runtime.appUrl, "/verify-email", token);
  const rendered = renderAccountEmail("verify", { appName: ctx.ast.appName, link });
  await sendQuietly(ctx.mailer, { to: email, ...rendered, meta: { purpose: "verify", token, link } });
}
