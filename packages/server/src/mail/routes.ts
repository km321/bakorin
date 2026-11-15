import { createHmac, timingSafeEqual } from "node:crypto";
import { Hono, type Context } from "hono";
import type { MailRuleAST, SchemaAST } from "@bakorin/core";
import { requireAdmin } from "../auth/guard.ts";
import type { AppContext } from "../context.ts";
import { decodeRow } from "../crud/query.ts";
import { MAIL_OUTBOX_TABLE } from "../db/system.ts";
import { TemplateError } from "./engine.ts";
import { hasLayout, listTemplates, MAIL_TEMPLATE_NAME, renderMail, type RenderedMail } from "./files.ts";
import {
  deliverMailById,
  enqueueMail,
  resolveAddresses,
  retryMailDelivery,
  viewMailDelivery,
  type MailDeliveryStatus,
} from "./outbox.ts";
import { appInfo, buildRuleData, sampleRuleData } from "./rules.ts";

const PREVIEW_TTL_MS = 5 * 60 * 1000;

export interface PreviewRequest {
  template?: string;
  ruleId?: string;
  entity?: string;
  recordId?: string;
}

export interface PreviewResult {
  template: string;
  ruleId: string | null;
  entity: string | null;
  recordId: string | null;
  sample: boolean;
  to: string[];
  cc: string[];
  bcc: string[];
  rendered: RenderedMail;
  data: Record<string, unknown>;
}

export class PreviewError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 422,
  ) {
    super(message);
  }
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

export function parsePreviewRequest(body: unknown): PreviewRequest {
  const raw = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  return {
    template: asString(raw.template),
    ruleId: asString(raw.ruleId),
    entity: asString(raw.entity),
    recordId: asString(raw.recordId),
  };
}

function relationFields(ast: SchemaAST, entityName: string | undefined): string[] {
  const entity = entityName ? ast.entityMap[entityName] : undefined;
  return (entity?.fields ?? []).filter((field) => field.relation).map((field) => field.name);
}

/**
 * Renders a template for the admin preview, the test send, and the CLI. A real
 * record is loaded in a system context and sanitized exactly like rule sends.
 */
export async function buildPreview(
  ctx: Pick<AppContext, "ast" | "db" | "projectDir">,
  request: PreviewRequest,
): Promise<PreviewResult> {
  const { ast, db, projectDir } = ctx;
  let rule: MailRuleAST | undefined;
  if (request.ruleId) {
    rule = (ast.mail ?? []).find((item) => item.id === request.ruleId);
    if (!rule) {
      throw new PreviewError(`mail rule ${request.ruleId} not found`, 404);
    }
  }
  const template = rule?.template ?? request.template;
  if (!template || !MAIL_TEMPLATE_NAME.test(template)) {
    throw new PreviewError("choose a template or a mail rule", 400);
  }
  rule = rule ?? (ast.mail ?? []).find((item) => item.template === template && (!request.entity || item.entity === request.entity));
  const entityName = rule?.entity ?? request.entity;
  if (entityName && !ast.entityMap[entityName]) {
    throw new PreviewError(`entity ${entityName} not found`, 404);
  }
  const expand = rule?.expand ?? relationFields(ast, entityName);
  let data: Record<string, unknown>;
  let sample = true;
  if (entityName && request.recordId) {
    const entity = ast.entityMap[entityName];
    const row = entity
      ? await db.selectFrom(entityName).selectAll().where("id", "=", request.recordId).executeTakeFirst()
      : undefined;
    if (!entity || !row) {
      throw new PreviewError(`${entityName} record ${request.recordId} not found`, 404);
    }
    const decoded = decodeRow(entity, row as Record<string, unknown>);
    const op = rule?.events[0] ?? "create";
    data = await buildRuleData(db, ast, { expand }, { entity: entityName, op, before: decoded, after: decoded });
    sample = false;
  } else if (entityName) {
    data = sampleRuleData(ast, entityName, expand);
  } else {
    data = { app: appInfo(ast), sample: true };
  }
  let rendered: RenderedMail;
  try {
    rendered = renderMail(projectDir, { template, data, subject: rule?.subject });
  } catch (error) {
    if (error instanceof TemplateError) {
      throw new PreviewError(error.message, 422);
    }
    throw error;
  }
  return {
    template,
    ruleId: rule?.id ?? null,
    entity: entityName ?? null,
    recordId: request.recordId ?? null,
    sample,
    to: rule ? resolveAddresses(rule.to, data).valid : [],
    cc: rule ? resolveAddresses(rule.cc, data).valid : [],
    bcc: rule ? resolveAddresses(rule.bcc, data).valid : [],
    rendered,
    data,
  };
}

function signPreview(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(`mail-preview.${payload}`).digest("base64url");
}

export function createPreviewToken(secret: string, request: PreviewRequest, actorId: string, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ ...request, sub: actorId, exp: now + PREVIEW_TTL_MS })).toString(
    "base64url",
  );
  return `${payload}.${signPreview(secret, payload)}`;
}

export function readPreviewToken(
  secrets: Array<string | undefined>,
  token: string,
  now = Date.now(),
): (PreviewRequest & { sub: string }) | null {
  const [payload, signature] = token.split(".");
  if (!payload || !signature) {
    return null;
  }
  const given = Buffer.from(signature);
  const valid = secrets.some((secret) => {
    if (!secret) {
      return false;
    }
    const expected = Buffer.from(signPreview(secret, payload));
    return expected.length === given.length && timingSafeEqual(expected, given);
  });
  if (!valid) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
    if (typeof parsed.exp !== "number" || parsed.exp < now || typeof parsed.sub !== "string") {
      return null;
    }
    return { ...parsePreviewRequest(parsed), sub: parsed.sub };
  } catch {
    return null;
  }
}

export const MAIL_FRAME_PATH = "/api/v1/mail/frame";

/** CSP for the rendered email inside the admin preview iframe: styles and images only, no scripts. */
export const MAIL_FRAME_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; img-src https: http: data:; font-src https: data:; frame-ancestors 'self'; base-uri 'none'; form-action 'none'; sandbox";

async function actorIsAdmin(ctx: AppContext, actorId: string): Promise<boolean> {
  const auth = ctx.ast.auth;
  const row = await ctx.db
    .selectFrom(auth.entity)
    .select([auth.roleField])
    .where("id", "=", actorId)
    .executeTakeFirst();
  return Boolean(row) && String((row as Record<string, unknown>)[auth.roleField]) === auth.adminRole;
}

async function actorEmail(ctx: AppContext, actorId: string): Promise<string | null> {
  const auth = ctx.ast.auth;
  const row = await ctx.db
    .selectFrom(auth.entity)
    .select([auth.identityField])
    .where("id", "=", actorId)
    .executeTakeFirst();
  const value = row ? (row as Record<string, unknown>)[auth.identityField] : null;
  return typeof value === "string" && value.includes("@") ? value : null;
}

function parseStatus(value: string | null): MailDeliveryStatus | undefined {
  switch (value) {
    case "pending":
    case "sending":
    case "sent":
    case "failed":
      return value;
    default:
      return undefined;
  }
}

function previewError(c: Context, error: unknown): Response {
  if (error instanceof PreviewError) {
    const code = error.status === 404 ? "not_found" : error.status === 422 ? "template_error" : "bad_request";
    return c.json({ error: { code, message: error.message } }, error.status);
  }
  throw error;
}

export function createMailRoutes(): Hono {
  const app = new Hono();

  app.get("/", (c) => {
    const denied = requireAdmin(c);
    if (denied) {
      return denied;
    }
    const ctx = c.get("app");
    const rules = ctx.ast.mail ?? [];
    const templates = listTemplates(ctx.projectDir).map((template) => ({
      ...template,
      rules: rules.filter((rule) => rule.template === template.name).map((rule) => rule.id),
    }));
    return c.json({
      data: {
        driver: ctx.mailer.driver,
        layout: hasLayout(ctx.projectDir),
        templates,
        rules: rules.map((rule) => ({
          id: rule.id,
          entity: rule.entity,
          events: rule.events,
          template: rule.template,
          to: rule.to,
          cc: rule.cc,
          bcc: rule.bcc,
          replyTo: rule.replyTo ?? null,
          subject: rule.subject ?? null,
          when: rule.when,
          changed: rule.changed,
          expand: rule.expand,
          maxAttempts: rule.maxAttempts,
        })),
      },
    });
  });

  app.post("/preview", async (c) => {
    const denied = requireAdmin(c);
    if (denied) {
      return denied;
    }
    const ctx = c.get("app");
    const request = parsePreviewRequest(await c.req.json().catch(() => ({})));
    try {
      const preview = await buildPreview(ctx, request);
      const actor = c.get("actor");
      const token = createPreviewToken(ctx.ast.runtime.jwtSecret, request, actor?.id ?? "");
      return c.json({
        data: {
          template: preview.template,
          ruleId: preview.ruleId,
          entity: preview.entity,
          recordId: preview.recordId,
          sample: preview.sample,
          to: preview.to,
          cc: preview.cc,
          bcc: preview.bcc,
          subject: preview.rendered.subject,
          html: preview.rendered.html,
          text: preview.rendered.text,
          frameUrl: `${MAIL_FRAME_PATH}?token=${encodeURIComponent(token)}`,
        },
      });
    } catch (error) {
      return previewError(c, error);
    }
  });

  // Loaded by the sandboxed preview iframe, which cannot send the bearer token.
  // Access is a short-lived HMAC token minted by POST /preview for an admin.
  app.get("/frame", async (c) => {
    const ctx = c.get("app");
    const token = c.req.query("token") ?? "";
    const request = readPreviewToken([ctx.ast.runtime.jwtSecret, ctx.ast.runtime.jwtSecretPrevious], token);
    if (!request || !(await actorIsAdmin(ctx, request.sub))) {
      return c.text("Preview link expired. Refresh the preview in the admin.", 403);
    }
    try {
      const preview = await buildPreview(ctx, request);
      return c.html(preview.rendered.html, 200, { "cache-control": "no-store" });
    } catch (error) {
      if (error instanceof PreviewError) {
        return c.text(error.message, error.status);
      }
      throw error;
    }
  });

  app.post("/test", async (c) => {
    const denied = requireAdmin(c);
    if (denied) {
      return denied;
    }
    const ctx = c.get("app");
    const actor = c.get("actor");
    const email = actor ? await actorEmail(ctx, actor.id) : null;
    if (!email) {
      return c.json({ error: { code: "bad_request", message: "your account has no email address to send to" } }, 400);
    }
    const request = parsePreviewRequest(await c.req.json().catch(() => ({})));
    let preview: PreviewResult;
    try {
      preview = await buildPreview(ctx, request);
    } catch (error) {
      return previewError(c, error);
    }
    const result = await enqueueMail(ctx.db, {
      source: "test",
      ruleId: preview.ruleId,
      template: preview.template,
      entity: preview.entity,
      recordId: preview.recordId,
      event: "test",
      to: [email],
      literalAddresses: true,
      data: preview.data,
      maxAttempts: 1,
      render: () => ({ ...preview.rendered, subject: `[Test] ${preview.rendered.subject}` }),
    });
    await deliverMailById(ctx.db, ctx.mailer, result.id);
    const row = await ctx.db.selectFrom(MAIL_OUTBOX_TABLE).selectAll().where("id", "=", result.id).executeTakeFirst();
    return c.json({ data: row ? viewMailDelivery(row as Record<string, unknown>) : null }, 201);
  });

  app.get("/deliveries", async (c) => {
    const denied = requireAdmin(c);
    if (denied) {
      return denied;
    }
    const url = new URL(c.req.url);
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") ?? 50) || 50));
    const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0) || 0);
    const status = parseStatus(url.searchParams.get("status"));
    const db = c.get("app").db;
    let countQuery = db.selectFrom(MAIL_OUTBOX_TABLE).select(db.fn.countAll().as("count"));
    let listQuery = db.selectFrom(MAIL_OUTBOX_TABLE).selectAll();
    if (status) {
      countQuery = countQuery.where("status", "=", status);
      listQuery = listQuery.where("status", "=", status);
    }
    const totalRow = await countQuery.executeTakeFirst();
    const rows = await listQuery.orderBy("created_at", "desc").limit(limit).offset(offset).execute();
    return c.json({
      data: rows.map((row) => viewMailDelivery(row as Record<string, unknown>)),
      meta: { total: Number(totalRow?.count ?? 0), limit, offset },
    });
  });

  app.post("/deliveries/:id/retry", async (c) => {
    const denied = requireAdmin(c);
    if (denied) {
      return denied;
    }
    const ctx = c.get("app");
    const id = c.req.param("id");
    const result = await retryMailDelivery(ctx.db, id);
    switch (result) {
      case "missing":
        return c.json({ error: { code: "not_found", message: "delivery not found" } }, 404);
      case "not_failed":
        return c.json({ error: { code: "conflict", message: "only failed deliveries can be retried" } }, 409);
      case "not_retryable":
        return c.json(
          { error: { code: "conflict", message: "this delivery never rendered; fix the template or rule instead" } },
          409,
        );
      case "ok":
        await deliverMailById(ctx.db, ctx.mailer, id);
        break;
      default: {
        const exhaustive: never = result;
        return exhaustive;
      }
    }
    const row = await ctx.db.selectFrom(MAIL_OUTBOX_TABLE).selectAll().where("id", "=", id).executeTakeFirst();
    if (!row) {
      return c.json({ error: { code: "not_found", message: "delivery not found" } }, 404);
    }
    return c.json({ data: viewMailDelivery(row as Record<string, unknown>) });
  });

  return app;
}
