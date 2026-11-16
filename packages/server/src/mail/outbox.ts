import { MAIL_DEFAULT_MAX_ATTEMPTS, type ChangeEvent, type MailRuleAST, type SchemaAST } from "@bakorin/core";
import type { BakorinDb } from "../db/dialects.ts";
import { MAIL_OUTBOX_TABLE } from "../db/system.ts";
import { acquireLease, instanceHolder } from "../db/leases.ts";
import { shortError } from "../webhooks/dispatcher.ts";
import { compileTemplate } from "./engine.ts";
import { renderMail, type RenderedMail } from "./files.ts";
import { brandData, buildRuleData, matchingRules } from "./rules.ts";
import type { Mailer, MailMessage } from "./types.ts";
import { isAuthKind, unsealMail, type AuthEmailKind } from "./auth.ts";

/** Lifetime of the one time links in system emails (matches auth/account.ts). */
export const AUTH_LINK_TTL_MS: Record<AuthEmailKind, number> = {
  verify: 24 * 60 * 60 * 1000,
  reset: 60 * 60 * 1000,
  invite: 7 * 24 * 60 * 60 * 1000,
};

export type MailDeliveryStatus = "pending" | "sending" | "sent" | "failed" | "discarded";
export type MailSource = "rule" | "hook" | "test" | "auth";

const CLAIM_MS = 60_000;

const EMAIL = /^[^\s@<>()[\]\\,;:"]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/;

/** Accepts "a@b.co" or "Name <a@b.co>". Returns null for anything else, including CR/LF. */
export function normalizeAddress(raw: string): string | null {
  const value = raw.trim();
  if (!value || /[\r\n]/.test(value) || value.length > 320) {
    return null;
  }
  const named = /^([^<>"\r\n]*)<([^<>\s]+)>$/.exec(value);
  if (named) {
    const name = (named[1] ?? "").trim();
    const email = named[2] ?? "";
    if (!EMAIL.test(email)) {
      return null;
    }
    return name ? `${name} <${email}>` : email;
  }
  return EMAIL.test(value) ? value : null;
}

export interface ResolvedAddresses {
  valid: string[];
  invalid: string[];
}

/** Renders address templates (text mode) and validates every result. */
export function resolveAddresses(
  templates: string[],
  data: Record<string, unknown>,
  literal = false,
): ResolvedAddresses {
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const template of templates) {
    const rendered = literal ? template : compileTemplate(template, { name: "address" }).render(data, "text");
    const parts = rendered.includes("<") ? [rendered] : rendered.split(",");
    for (const part of parts) {
      if (part.trim() === "") {
        continue;
      }
      const address = normalizeAddress(part);
      if (address) {
        if (!valid.includes(address)) {
          valid.push(address);
        }
      } else {
        invalid.push(part.trim().slice(0, 80));
      }
    }
  }
  return { valid, invalid };
}

export interface EnqueueMailInput {
  source: MailSource;
  idempotencyKey?: string;
  ruleId?: string | null;
  template?: string | null;
  entity?: string | null;
  recordId?: string | null;
  event?: string | null;
  to: string[];
  cc?: string[];
  bcc?: string[];
  replyTo?: string | null;
  /** True when addresses come from code and must not be treated as templates. */
  literalAddresses?: boolean;
  data: Record<string, unknown>;
  maxAttempts?: number;
  /** System emails: verify, reset, or invite. */
  purpose?: string | null;
  /** Encrypted real body (see mail/auth.ts). html/text from render are then the redacted copy. */
  sealed?: string | null;
  /** Produces subject, html, and text. Errors mark the delivery failed instead of throwing. */
  render: () => RenderedMail;
}

export interface EnqueueResult {
  id: string;
  status: MailDeliveryStatus;
  duplicate: boolean;
  error: string | null;
}

async function findByKey(db: BakorinDb, key: string): Promise<Record<string, unknown> | undefined> {
  return (await db.selectFrom(MAIL_OUTBOX_TABLE).selectAll().where("idempotency_key", "=", key).executeTakeFirst()) as
    | Record<string, unknown>
    | undefined;
}

export async function enqueueMail(db: BakorinDb, input: EnqueueMailInput): Promise<EnqueueResult> {
  const id = crypto.randomUUID();
  const key = input.idempotencyKey ?? `${input.source}:${id}`;
  const existing = await findByKey(db, key);
  if (existing) {
    return { id: String(existing.id), status: String(existing.status) as MailDeliveryStatus, duplicate: true, error: null };
  }
  let rendered: RenderedMail = { subject: "", html: "", text: "" };
  let error: string | null = null;
  const literal = input.literalAddresses === true;
  const to = resolveAddresses(input.to, input.data, literal);
  const cc = resolveAddresses(input.cc ?? [], input.data, literal);
  const bcc = resolveAddresses(input.bcc ?? [], input.data, literal);
  const replyTo = input.replyTo ? resolveAddresses([input.replyTo], input.data, literal) : { valid: [], invalid: [] };
  try {
    rendered = input.render();
  } catch (cause) {
    error = shortError(cause instanceof Error ? cause.message : String(cause));
  }
  const invalid = [...to.invalid, ...cc.invalid, ...bcc.invalid, ...replyTo.invalid];
  if (!error && invalid.length > 0) {
    error = shortError(`invalid email address: ${invalid.join(", ")}`);
  }
  if (!error && to.valid.length === 0) {
    error = "no recipients: the to address rendered empty";
  }
  const now = new Date().toISOString();
  const status: MailDeliveryStatus = error ? "failed" : "pending";
  try {
    await db
      .insertInto(MAIL_OUTBOX_TABLE)
      .values({
        id,
        idempotency_key: key,
        source: input.source,
        rule_id: input.ruleId ?? null,
        template: input.template ?? null,
        entity: input.entity ?? null,
        record_id: input.recordId ?? null,
        event: input.event ?? null,
        to_addrs: JSON.stringify(to.valid),
        cc_addrs: JSON.stringify(cc.valid),
        bcc_addrs: JSON.stringify(bcc.valid),
        reply_to: replyTo.valid[0] ?? null,
        subject: rendered.subject,
        html: rendered.html,
        body_text: rendered.text,
        attempts: 0,
        max_attempts: input.maxAttempts ?? MAIL_DEFAULT_MAX_ATTEMPTS,
        status,
        last_error: error,
        locked_until: null,
        next_attempt_at: now,
        sent_at: null,
        created_at: now,
        purpose: input.purpose ?? null,
        sealed: error ? null : (input.sealed ?? null),
      })
      .execute();
  } catch (cause) {
    const raced = await findByKey(db, key);
    if (raced) {
      return { id: String(raced.id), status: String(raced.status) as MailDeliveryStatus, duplicate: true, error: null };
    }
    throw cause;
  }
  return { id, status, duplicate: false, error };
}

function recordIdOf(event: ChangeEvent): string | null {
  const record = event.after ?? event.before;
  const id = record?.id;
  return id === undefined || id === null ? null : String(id);
}

function ruleKey(rule: MailRuleAST, event: ChangeEvent): string {
  const recordId = recordIdOf(event) ?? crypto.randomUUID();
  const base = `rule:${rule.id}:${event.entity}:${recordId}:${event.op}`;
  if (event.op === "update") {
    const stamp = event.after?.updatedAt;
    return `${base}:${typeof stamp === "string" && stamp ? stamp : crypto.randomUUID()}`;
  }
  return base;
}

export async function enqueueRuleMail(
  db: BakorinDb,
  ast: SchemaAST,
  projectDir: string,
  rule: MailRuleAST,
  event: ChangeEvent,
): Promise<EnqueueResult> {
  const data = await buildRuleData(db, ast, rule, event);
  return enqueueMail(db, {
    source: "rule",
    idempotencyKey: ruleKey(rule, event),
    ruleId: rule.id,
    template: rule.template,
    entity: event.entity,
    recordId: recordIdOf(event),
    event: `${event.entity}.${event.op}`,
    to: rule.to,
    cc: rule.cc,
    bcc: rule.bcc,
    replyTo: rule.replyTo ?? null,
    data,
    maxAttempts: rule.maxAttempts,
    render: () => renderMail(projectDir, { template: rule.template, data, subject: rule.subject }),
  });
}

/** Mail consumes the same post-write change bus as webhooks and after hooks. */
export function subscribeMail(
  getAst: () => SchemaAST,
  db: BakorinDb,
  projectDir: string,
  subscribe: (handler: (event: ChangeEvent) => void) => void,
): void {
  subscribe((event) => {
    void (async () => {
      const ast = getAst();
      for (const rule of matchingRules(ast, event)) {
        try {
          await enqueueRuleMail(db, ast, projectDir, rule, event);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error(`[bakorin:mail] could not queue ${rule.id}: ${shortError(message)}`);
        }
      }
    })();
  });
}

export interface HookMailInput {
  to: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  replyTo?: string;
  subject?: string;
  template?: string;
  data?: Record<string, unknown>;
  html?: string;
  text?: string;
  idempotencyKey?: string;
  maxAttempts?: number;
}

export interface MailApi {
  send(input: HookMailInput): Promise<{ id: string; status: MailDeliveryStatus; duplicate: boolean }>;
}

function list(value: string | string[] | undefined): string[] {
  if (value === undefined) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

export function createMailApi(db: BakorinDb, getAst: () => SchemaAST, projectDir: string): MailApi {
  return {
    async send(input) {
      if (!input || typeof input !== "object") {
        throw new Error("ctx.mail.send needs an object like { to, subject, template, data }");
      }
      const ast = getAst();
      const data = { app: { name: ast.appName, url: ast.runtime.appUrl }, ...brandData(ast), ...(input.data ?? {}) };
      const result = await enqueueMail(db, {
        source: "hook",
        idempotencyKey: input.idempotencyKey ? `hook:${input.idempotencyKey}` : undefined,
        template: input.template ?? null,
        to: list(input.to),
        cc: list(input.cc),
        bcc: list(input.bcc),
        replyTo: input.replyTo ?? null,
        literalAddresses: true,
        data,
        maxAttempts: input.maxAttempts,
        render: () =>
          renderMail(projectDir, {
            template: input.template,
            data,
            subject: input.subject,
            html: input.html,
            text: input.text,
          }),
      });
      if (result.error) {
        throw new Error(`ctx.mail.send: ${result.error}`);
      }
      return { id: result.id, status: result.status, duplicate: result.duplicate };
    },
  };
}

function parseList(value: unknown): string[] {
  try {
    const parsed = JSON.parse(String(value ?? "[]")) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export interface WorkerOptions {
  stopped?: () => boolean;
  holder?: string;
}

export function startMailWorker(db: BakorinDb, getAst: () => SchemaAST, getMailer: () => Mailer): () => void {
  const holder = instanceHolder();
  let stopped = false;
  let running = false;
  const tick = () => {
    if (stopped || running) {
      return;
    }
    running = true;
    void drainMailOutbox(db, getAst, getMailer, { stopped: () => stopped, holder }).finally(() => {
      running = false;
    });
  };
  const timer = setInterval(tick, 1000);
  tick();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

/**
 * Rows stuck in "sending" mean a worker stopped between handing the message to the
 * provider and recording the result. Resend deduplicates on the Idempotency-Key
 * (the delivery id), so those rows can safely go back to pending. Other drivers
 * cannot deduplicate, so the row is failed for a human to check instead of risking
 * a second copy.
 */
export async function recoverStuckSends(db: BakorinDb, mailer: Mailer): Promise<number> {
  const now = new Date().toISOString();
  const update =
    mailer.driver === "resend"
      ? { status: "pending", locked_until: null, next_attempt_at: now }
      : {
          status: "failed",
          locked_until: null,
          last_error: "delivery outcome unknown: the worker stopped mid-send. Check your provider before retrying.",
        };
  const result = await db
    .updateTable(MAIL_OUTBOX_TABLE)
    .set(update)
    .where("status", "=", "sending")
    .where("locked_until", "<", now)
    .executeTakeFirst();
  return Number(result?.numUpdatedRows ?? 0);
}

export interface DeliverOptions {
  /** JWT secrets (current, previous) used to open sealed system emails. */
  secrets?: Array<string | undefined>;
}

export async function drainMailOutbox(
  db: BakorinDb,
  getAst: () => SchemaAST,
  getMailer: () => Mailer,
  options: WorkerOptions = {},
): Promise<void> {
  const stopped = options.stopped ?? (() => false);
  const holder = options.holder ?? instanceHolder();
  if (stopped()) {
    return;
  }
  try {
    const got = await acquireLease(db, "mail-dispatcher", holder, 15_000);
    if (!got || stopped()) {
      return;
    }
    const ast = getAst();
    const mailer = getMailer();
    await cleanupSentMail(db, ast.runtime.mailRetainDays);
    await recoverStuckSends(db, mailer);
    const now = new Date().toISOString();
    const rows = await db
      .selectFrom(MAIL_OUTBOX_TABLE)
      .select("id")
      .where("status", "=", "pending")
      .where("next_attempt_at", "<=", now)
      .orderBy("created_at", "asc")
      .limit(20)
      .execute();
    for (const row of rows) {
      if (stopped()) {
        return;
      }
      await deliverMailById(db, mailer, String(row.id), {
        secrets: [ast.runtime.jwtSecret, ast.runtime.jwtSecretPrevious],
      });
    }
  } catch {
    // Database already closed during shutdown.
  }
}

/** Claims one pending row and sends it. A row that is not pending is never sent. */
export async function deliverMailById(
  db: BakorinDb,
  mailer: Mailer,
  id: string,
  options: DeliverOptions = {},
): Promise<MailDeliveryStatus | null> {
  const now = new Date().toISOString();
  const claimed = await db
    .updateTable(MAIL_OUTBOX_TABLE)
    .set({ status: "sending", locked_until: new Date(Date.now() + CLAIM_MS).toISOString() })
    .where("id", "=", id)
    .where("status", "=", "pending")
    .where("next_attempt_at", "<=", now)
    .executeTakeFirst();
  if (Number(claimed?.numUpdatedRows ?? 0) < 1) {
    return null;
  }
  const row = (await db.selectFrom(MAIL_OUTBOX_TABLE).selectAll().where("id", "=", id).executeTakeFirst()) as
    | Record<string, unknown>
    | undefined;
  if (!row) {
    return null;
  }
  const attempts = Number(row.attempts) + 1;
  let html = String(row.html);
  let text = String(row.body_text);
  let meta: MailMessage["meta"] = { purpose: "mail" };
  if (row.sealed) {
    const opened = unsealMail(options.secrets ?? [], String(row.sealed));
    if (!opened) {
      await db
        .updateTable(MAIL_OUTBOX_TABLE)
        .set({
          attempts,
          status: "failed",
          locked_until: null,
          last_error: "cannot open this system email (the JWT secret changed). Ask the user to request a new one.",
        })
        .where("id", "=", id)
        .execute();
      return "failed";
    }
    html = opened.html;
    text = opened.text;
    meta = opened.meta ?? meta;
  }
  try {
    await mailer.send({
      to: parseList(row.to_addrs),
      cc: parseList(row.cc_addrs),
      bcc: parseList(row.bcc_addrs),
      replyTo: row.reply_to ? String(row.reply_to) : undefined,
      subject: String(row.subject),
      html,
      text,
      idempotencyKey: id,
      meta,
    });
  } catch (error) {
    const maxAttempts = Number(row.max_attempts) || MAIL_DEFAULT_MAX_ATTEMPTS;
    const failed = attempts >= maxAttempts;
    const delay = Math.min(60_000, 100 * 2 ** Math.min(attempts, 8));
    const message = error instanceof Error ? error.message : String(error);
    await db
      .updateTable(MAIL_OUTBOX_TABLE)
      .set({
        attempts,
        status: failed ? "failed" : "pending",
        last_error: shortError(message),
        locked_until: null,
        next_attempt_at: failed ? new Date().toISOString() : new Date(Date.now() + delay).toISOString(),
      })
      .where("id", "=", id)
      .where("status", "=", "sending")
      .execute();
    return failed ? "failed" : "pending";
  }
  await db
    .updateTable(MAIL_OUTBOX_TABLE)
    .set({
      attempts,
      status: "sent",
      sent_at: new Date().toISOString(),
      last_error: null,
      locked_until: null,
      sealed: null,
    })
    .where("id", "=", id)
    .execute();
  return "sent";
}

export async function cleanupSentMail(db: BakorinDb, retainDays: number): Promise<number> {
  const cutoff = new Date(Date.now() - retainDays * 24 * 60 * 60 * 1000).toISOString();
  const result = await db
    .deleteFrom(MAIL_OUTBOX_TABLE)
    .where("status", "=", "sent")
    .where("sent_at", "<", cutoff)
    .executeTakeFirst();
  const discarded = await db
    .deleteFrom(MAIL_OUTBOX_TABLE)
    .where("status", "=", "discarded")
    .where("created_at", "<", cutoff)
    .executeTakeFirst();
  return Number(result?.numDeletedRows ?? 0) + Number(discarded?.numDeletedRows ?? 0);
}

/** Marks a failed delivery as discarded so it stops counting as a failure. The row is kept for the record. */
export async function discardMailDelivery(db: BakorinDb, id: string): Promise<"ok" | "missing" | "not_failed"> {
  const row = await db.selectFrom(MAIL_OUTBOX_TABLE).select(["status"]).where("id", "=", id).executeTakeFirst();
  if (!row) {
    return "missing";
  }
  if (String(row.status) !== "failed") {
    return "not_failed";
  }
  await db.updateTable(MAIL_OUTBOX_TABLE).set({ status: "discarded", locked_until: null }).where("id", "=", id).execute();
  return "ok";
}

/** Only failed rows can be retried. A sent row is final and is never sent again. */
export async function retryMailDelivery(
  db: BakorinDb,
  id: string,
): Promise<"ok" | "missing" | "not_failed" | "not_retryable" | "expired"> {
  const row = await db
    .selectFrom(MAIL_OUTBOX_TABLE)
    .select(["status", "to_addrs", "subject", "purpose", "sealed", "created_at"])
    .where("id", "=", id)
    .executeTakeFirst();
  if (!row) {
    return "missing";
  }
  if (String(row.status) !== "failed") {
    return "not_failed";
  }
  if (parseList(row.to_addrs).length === 0 || !String(row.subject ?? "")) {
    return "not_retryable";
  }
  if (row.purpose && isAuthKind(row.purpose)) {
    const age = Date.now() - new Date(String(row.created_at)).getTime();
    if (!row.sealed || age > AUTH_LINK_TTL_MS[row.purpose]) {
      return "expired";
    }
  }
  await db
    .updateTable(MAIL_OUTBOX_TABLE)
    .set({ status: "pending", locked_until: null, attempts: 0, next_attempt_at: new Date().toISOString() })
    .where("id", "=", id)
    .where("status", "=", "failed")
    .execute();
  return "ok";
}

export function viewMailDelivery(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    source: String(row.source),
    purpose: row.purpose == null ? null : String(row.purpose),
    ruleId: row.rule_id == null ? null : String(row.rule_id),
    template: row.template == null ? null : String(row.template),
    entity: row.entity == null ? null : String(row.entity),
    recordId: row.record_id == null ? null : String(row.record_id),
    event: row.event == null ? null : String(row.event),
    to: parseList(row.to_addrs),
    cc: parseList(row.cc_addrs),
    bcc: parseList(row.bcc_addrs),
    replyTo: row.reply_to == null ? null : String(row.reply_to),
    subject: String(row.subject ?? ""),
    status: String(row.status) as MailDeliveryStatus,
    attempts: Number(row.attempts ?? 0),
    maxAttempts: Number(row.max_attempts ?? MAIL_DEFAULT_MAX_ATTEMPTS),
    lastError: row.last_error == null ? null : String(row.last_error),
    nextAttemptAt: row.next_attempt_at == null ? null : String(row.next_attempt_at),
    sentAt: row.sent_at == null ? null : String(row.sent_at),
    createdAt: String(row.created_at),
  };
}

export type MailDeliveryView = ReturnType<typeof viewMailDelivery>;
