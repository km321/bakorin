import { Hono } from "hono";
import { requireAdmin } from "../auth/guard.ts";
import { WEBHOOK_OUTBOX_TABLE } from "../db/system.ts";
import {
  deliverById,
  enqueueWebhook,
  retryDelivery,
  sampleTestEvent,
  webhookHost,
  type WebhookDeliveryStatus,
} from "./dispatcher.ts";

export interface WebhookConfigView {
  id: string;
  entity: string;
  events: string[];
  urlHost: string;
  maxAttempts: number;
  timeoutMs: number;
}

export interface WebhookDeliveryView {
  id: string;
  webhookId: string | null;
  event: string;
  urlHost: string;
  status: WebhookDeliveryStatus;
  attempts: number;
  lastStatusCode: number | null;
  lastError: string | null;
  createdAt: string;
  deliveredAt: string | null;
  nextAttemptAt: string;
}

function parseStatus(value: string | undefined): WebhookDeliveryStatus | undefined {
  switch (value) {
    case "pending":
    case "delivered":
    case "failed":
      return value;
    case undefined:
    case "":
    case "all":
      return undefined;
    default:
      return undefined;
  }
}

function asStatus(value: unknown): WebhookDeliveryStatus {
  switch (value) {
    case "pending":
    case "delivered":
    case "failed":
      return value;
    default:
      return "pending";
  }
}

function viewDelivery(row: Record<string, unknown>): WebhookDeliveryView {
  return {
    id: String(row.id),
    webhookId: row.webhook_id ? String(row.webhook_id) : null,
    event: String(row.event ?? ""),
    urlHost: webhookHost(String(row.url ?? "")),
    status: asStatus(row.status),
    attempts: Number(row.attempts ?? 0),
    lastStatusCode: row.last_status_code == null ? null : Number(row.last_status_code),
    lastError: row.last_error == null ? null : String(row.last_error),
    createdAt: String(row.created_at),
    deliveredAt: row.delivered_at == null ? null : String(row.delivered_at),
    nextAttemptAt: String(row.next_attempt_at),
  };
}

export function createWebhookRoutes(): Hono {
  const app = new Hono();

  app.get("/", (c) => {
    const denied = requireAdmin(c);
    if (denied) {
      return denied;
    }
    const ast = c.get("app").ast;
    const data: WebhookConfigView[] = ast.webhooks.map((hook) => ({
      id: hook.id,
      entity: hook.entity,
      events: hook.events,
      urlHost: webhookHost(hook.url),
      maxAttempts: hook.maxAttempts,
      timeoutMs: hook.timeoutMs,
    }));
    return c.json({ data });
  });

  app.get("/deliveries", async (c) => {
    const denied = requireAdmin(c);
    if (denied) {
      return denied;
    }
    const url = new URL(c.req.url);
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") ?? 50) || 50));
    const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0) || 0);
    const status = parseStatus(url.searchParams.get("status") ?? undefined);
    const db = c.get("app").db;
    let countQuery = db.selectFrom(WEBHOOK_OUTBOX_TABLE).select(db.fn.countAll().as("count"));
    let listQuery = db.selectFrom(WEBHOOK_OUTBOX_TABLE).selectAll();
    if (status) {
      countQuery = countQuery.where("status", "=", status);
      listQuery = listQuery.where("status", "=", status);
    }
    const totalRow = await countQuery.executeTakeFirst();
    const rows = await listQuery.orderBy("created_at", "desc").limit(limit).offset(offset).execute();
    return c.json({
      data: rows.map((row) => viewDelivery(row)),
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
    const result = await retryDelivery(ctx.db, id);
    switch (result) {
      case "missing":
        return c.json({ error: { code: "not_found", message: "delivery not found" } }, 404);
      case "not_failed":
        return c.json({ error: { code: "conflict", message: "only failed deliveries can be retried" } }, 409);
      case "ok":
        await deliverById(ctx.db, () => ctx.ast, id);
        break;
      default: {
        const exhaustive: never = result;
        return exhaustive;
      }
    }
    const row = await ctx.db.selectFrom(WEBHOOK_OUTBOX_TABLE).selectAll().where("id", "=", id).executeTakeFirst();
    if (!row) {
      return c.json({ error: { code: "not_found", message: "delivery not found" } }, 404);
    }
    return c.json({ data: viewDelivery(row) });
  });

  app.post("/:id/test", async (c) => {
    const denied = requireAdmin(c);
    if (denied) {
      return denied;
    }
    const ctx = c.get("app");
    const hook = ctx.ast.webhooks.find((item) => item.id === c.req.param("id"));
    if (!hook) {
      return c.json({ error: { code: "not_found", message: "webhook not found" } }, 404);
    }
    const event = sampleTestEvent(ctx.ast, hook);
    const id = await enqueueWebhook(ctx.db, ctx.ast, hook, event, { test: true });
    await deliverById(ctx.db, () => ctx.ast, id);
    const row = await ctx.db.selectFrom(WEBHOOK_OUTBOX_TABLE).selectAll().where("id", "=", id).executeTakeFirst();
    if (!row) {
      return c.json({ error: { code: "not_found", message: "delivery not found" } }, 404);
    }
    return c.json({ data: viewDelivery(row) }, 201);
  });

  return app;
}
