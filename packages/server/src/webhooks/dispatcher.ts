import { createHmac } from "node:crypto";
import {
  WEBHOOK_DEFAULT_MAX_ATTEMPTS,
  WEBHOOK_DEFAULT_TIMEOUT_MS,
  type ChangeEvent,
  type SchemaAST,
  type WebhookAST,
} from "@bakorin/core";
import type { BakorinDb } from "../db/dialects.ts";
import { WEBHOOK_OUTBOX_TABLE } from "../db/system.ts";
import { cleanupFinished, discardFailed, drainQueue, retryDelayMs, startQueueWorker, type DrainOptions } from "../delivery/queue.ts";
import { redactChangeEvent } from "./redact.ts";

export type WebhookDeliveryStatus = "pending" | "delivered" | "failed" | "discarded";

export interface DeliveryResult {
  ok: boolean;
  status: number | null;
  error: string | null;
}

export function signWebhookPayload(secret: string, timestamp: string, payload: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${payload}`, "utf8").digest("hex");
}

export function webhookHost(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

export function shortError(message: string, max = 240): string {
  const trimmed = message.replace(/\s+/g, " ").trim();
  if (trimmed.length <= max) {
    return trimmed;
  }
  return `${trimmed.slice(0, max - 3)}...`;
}

export function matchingHooks(ast: SchemaAST, event: ChangeEvent): WebhookAST[] {
  return ast.webhooks.filter((hook) => {
    if (hook.entity !== "*" && hook.entity !== event.entity) {
      return false;
    }
    return hook.events.includes(event.op);
  });
}

export async function enqueueWebhook(
  db: BakorinDb,
  ast: SchemaAST,
  hook: WebhookAST,
  event: ChangeEvent,
  options: { test?: boolean } = {},
): Promise<string> {
  const safe = redactChangeEvent(ast, event);
  const eventName = `${safe.entity}.${safe.op}`;
  const payloadObject: Record<string, unknown> = {
    event: eventName,
    entity: safe.entity,
    op: safe.op,
    before: safe.before,
    after: safe.after,
    actor: safe.actor,
  };
  if (options.test) {
    payloadObject.test = true;
  }
  const payload = JSON.stringify(payloadObject);
  const id = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-bakorin-event": eventName,
    "x-bakorin-delivery": id,
    "x-bakorin-timestamp": timestamp,
  };
  if (hook.secret) {
    headers["x-bakorin-signature"] = `sha256=${signWebhookPayload(hook.secret, timestamp, payload)}`;
  }
  await db
    .insertInto(WEBHOOK_OUTBOX_TABLE)
    .values({
      id,
      webhook_id: hook.id,
      event: eventName,
      url: hook.url,
      payload,
      headers: JSON.stringify(headers),
      attempts: 0,
      status: "pending",
      last_status_code: null,
      last_error: null,
      locked_until: null,
      next_attempt_at: timestamp,
      delivered_at: null,
      created_at: timestamp,
    })
    .execute();
  return id;
}

export async function postOnce(
  url: string,
  body: string,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<DeliveryResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { method: "POST", headers, body, signal: controller.signal });
    if (response.ok) {
      return { ok: true, status: response.status, error: null };
    }
    const text = await response.text().catch(() => "");
    const detail = text.trim() || response.statusText || `HTTP ${response.status}`;
    return { ok: false, status: response.status, error: shortError(detail) };
  } catch (error) {
    const aborted = error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
    if (aborted) {
      return { ok: false, status: null, error: `timed out after ${timeoutMs}ms` };
    }
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, status: null, error: shortError(message) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Each attempt gets a fresh x-bakorin-timestamp and signature, so a retry hours
 * later still passes a receiver's 5 minute replay window. x-bakorin-delivery
 * stays the same across attempts for deduplication.
 */
export function signForSend(
  stored: Record<string, string>,
  payload: string,
  secret: string | undefined,
  now: Date = new Date(),
): Record<string, string> {
  const headers = { ...stored };
  if (!secret) {
    return headers;
  }
  const timestamp = now.toISOString();
  headers["x-bakorin-timestamp"] = timestamp;
  headers["x-bakorin-signature"] = `sha256=${signWebhookPayload(secret, timestamp, payload)}`;
  return headers;
}

function hookForRow(ast: SchemaAST, row: Record<string, unknown>): WebhookAST | undefined {
  const id = typeof row.webhook_id === "string" ? row.webhook_id : "";
  return ast.webhooks.find((hook) => hook.id === id);
}

export function startWebhookWorker(db: BakorinDb, getAst: () => SchemaAST): () => void {
  return startQueueWorker((options) => drainWebhookOutbox(db, getAst, options));
}

/**
 * One pass over the webhook outbox. Rows are grouped by receiving host: each host
 * gets its deliveries in order, and a slow or down host does not hold up the rest.
 */
export async function drainWebhookOutbox(db: BakorinDb, getAst: () => SchemaAST, options: DrainOptions = {}): Promise<void> {
  const ast = getAst();
  await drainQueue<Record<string, unknown>>(
    db,
    {
      lease: "webhook-dispatcher",
      prepare: async () => {
        await cleanupDelivered(db, ast.runtime.webhooksRetainDays);
      },
      due: (limit) => {
        const now = new Date().toISOString();
        return db
          .selectFrom(WEBHOOK_OUTBOX_TABLE)
          .selectAll()
          .where("status", "=", "pending")
          .where("next_attempt_at", "<=", now)
          .where((eb) => eb.or([eb("locked_until", "is", null), eb("locked_until", "<=", now)]))
          .orderBy("created_at", "asc")
          .limit(limit)
          .execute() as Promise<Array<Record<string, unknown>>>;
      },
      laneOf: (row) => webhookHost(String(row.url)),
      deliver: async (row) => {
        const now = new Date().toISOString();
        const claimed = await db
          .updateTable(WEBHOOK_OUTBOX_TABLE)
          .set({ locked_until: new Date(Date.now() + 30_000).toISOString() })
          .where("id", "=", String(row.id))
          .where("status", "=", "pending")
          .where((eb) => eb.or([eb("locked_until", "is", null), eb("locked_until", "<=", now)]))
          .executeTakeFirst();
        if (Number(claimed?.numUpdatedRows ?? 0) < 1) {
          return;
        }
        await attemptClaimedRow(db, ast, row);
      },
    },
    options,
  );
}

async function attemptClaimedRow(db: BakorinDb, ast: SchemaAST, row: Record<string, unknown>): Promise<void> {
  const hook = hookForRow(ast, row);
  const timeoutMs = hook?.timeoutMs ?? WEBHOOK_DEFAULT_TIMEOUT_MS;
  const maxAttempts = hook?.maxAttempts ?? WEBHOOK_DEFAULT_MAX_ATTEMPTS;
  const headers = signForSend(JSON.parse(String(row.headers)) as Record<string, string>, String(row.payload), hook?.secret);
  const result = await postOnce(String(row.url), String(row.payload), headers, timeoutMs);
  const attempts = Number(row.attempts) + 1;
  if (result.ok) {
    await db
      .updateTable(WEBHOOK_OUTBOX_TABLE)
      .set({
        delivered_at: new Date().toISOString(),
        attempts,
        status: "delivered",
        last_status_code: result.status,
        last_error: null,
        locked_until: null,
      })
      .where("id", "=", String(row.id))
      .execute();
    return;
  }
  const failed = attempts >= maxAttempts;
  const delay = retryDelayMs(attempts);
  await db
    .updateTable(WEBHOOK_OUTBOX_TABLE)
    .set({
      attempts,
      status: failed ? "failed" : "pending",
      last_status_code: result.status,
      last_error: result.error,
      locked_until: null,
      next_attempt_at: failed ? new Date().toISOString() : new Date(Date.now() + delay).toISOString(),
    })
    .where("id", "=", String(row.id))
    .execute();
}

export async function deliverById(db: BakorinDb, getAst: () => SchemaAST, id: string): Promise<void> {
  const ast = getAst();
  const lockUntil = new Date(Date.now() + 30_000).toISOString();
  const claimed = await db
    .updateTable(WEBHOOK_OUTBOX_TABLE)
    .set({ locked_until: lockUntil })
    .where("id", "=", id)
    .where("status", "=", "pending")
    .executeTakeFirst();
  if (Number(claimed?.numUpdatedRows ?? 0) < 1) {
    return;
  }
  const row = await db.selectFrom(WEBHOOK_OUTBOX_TABLE).selectAll().where("id", "=", id).executeTakeFirst();
  if (!row) {
    return;
  }
  await attemptClaimedRow(db, ast, row);
}

export async function cleanupDelivered(db: BakorinDb, retainDays: number): Promise<number> {
  return cleanupFinished(db, WEBHOOK_OUTBOX_TABLE, { status: "delivered", at: "delivered_at" }, retainDays);
}

/** Marks a failed delivery as discarded so it stops counting as a failure. The row is kept for the record. */
export async function discardDelivery(db: BakorinDb, id: string): Promise<"ok" | "missing" | "not_failed"> {
  return discardFailed(db, WEBHOOK_OUTBOX_TABLE, id);
}

export async function retryDelivery(db: BakorinDb, id: string): Promise<"ok" | "missing" | "not_failed"> {
  const row = await db.selectFrom(WEBHOOK_OUTBOX_TABLE).selectAll().where("id", "=", id).executeTakeFirst();
  if (!row) {
    return "missing";
  }
  if (String(row.status) !== "failed") {
    return "not_failed";
  }
  await db
    .updateTable(WEBHOOK_OUTBOX_TABLE)
    .set({
      status: "pending",
      locked_until: null,
      next_attempt_at: new Date().toISOString(),
    })
    .where("id", "=", id)
    .execute();
  return "ok";
}

export function sampleTestEvent(ast: SchemaAST, hook: WebhookAST): ChangeEvent {
  const entityName = hook.entity === "*" ? ast.auth.entity : hook.entity;
  const entity = ast.entityMap[entityName];
  const now = new Date().toISOString();
  const after: Record<string, unknown> = {
    id: "00000000-0000-4000-8000-000000000000",
    createdAt: now,
    updatedAt: now,
  };
  if (entity) {
    for (const field of entity.fields) {
      if (field.secret || field.name === "id" || field.name === "createdAt" || field.name === "updatedAt") {
        continue;
      }
      if (field.name in after) {
        continue;
      }
      if (field.defaultValue !== undefined) {
        after[field.name] = field.defaultValue;
        continue;
      }
      switch (field.type) {
        case "boolean":
          after[field.name] = false;
          break;
        case "number":
        case "integer":
          after[field.name] = 0;
          break;
        case "email":
          after[field.name] = "webhook-test@example.com";
          break;
        case "enum":
          after[field.name] = field.enumValues?.[0] ?? "Webhook test";
          break;
        case "json":
          after[field.name] = { test: true };
          break;
        case "richtext":
          after[field.name] = "<p>Webhook test</p>";
          break;
        case "text":
        case "password":
        case "date":
        case "datetime":
        case "file":
        case "relation":
          after[field.name] = "Webhook test";
          break;
        default: {
          const exhaustive: never = field.type;
          return exhaustive;
        }
      }
    }
  }
  const op = hook.events[0] ?? "create";
  return {
    entity: entityName,
    op,
    before: op === "create" ? null : after,
    after: op === "delete" ? null : after,
    actor: null,
  };
}
