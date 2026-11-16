import type { Hono } from "hono";
import type { Actor } from "../context.ts";
import type { BakorinDb } from "../db/dialects.ts";
import type { MailApi } from "../mail/outbox.ts";

export interface HookContext {
  entity: string;
  record: Record<string, unknown>;
  before?: Record<string, unknown> | null;
  actor: Actor | null;
  db: BakorinDb;
  /**
   * Queue an email. Sends go through the mail outbox (retries, backoff, delivery
   * log), never inline. Prefer after* hooks so mail only goes out for saved writes.
   */
  mail: MailApi;
}

export interface EntityHooks {
  beforeCreate?: (ctx: HookContext) => Promise<Record<string, unknown> | void> | Record<string, unknown> | void;
  afterCreate?: (ctx: HookContext) => Promise<void> | void;
  beforeUpdate?: (ctx: HookContext) => Promise<Record<string, unknown> | void> | Record<string, unknown> | void;
  afterUpdate?: (ctx: HookContext) => Promise<void> | void;
  beforeDelete?: (ctx: HookContext) => Promise<void> | void;
  afterDelete?: (ctx: HookContext) => Promise<void> | void;
}

/** Header a front end sends the captcha or challenge token in. */
export const VERIFY_TOKEN_HEADER = "x-bakorin-verify";

export interface VerifyContext {
  /** signup: POST /auth/signup. create: a signed out POST /api/v1/:entity. */
  action: "signup" | "create";
  /** The auth entity for signup, or the entity being created. */
  entity: string;
  /** The value of the X-Bakorin-Verify header, or null. */
  token: string | null;
  /** Client IP (honors TRUST_PROXY). */
  ip: string;
  /** Request headers, for providers that send their own header. */
  headers: Headers;
}

/** true or undefined lets the request through. false or { ok: false } refuses it with 403. */
export type VerifyHookResult = boolean | void | { ok: boolean; message?: string };

/**
 * Optional project-local TypeScript module (runtime.hooks, default ./hooks.ts).
 * This is the customization escape hatch: per-entity lifecycle hooks plus
 * custom Hono routes. It is not a plugin system.
 */
export interface BakorinHooks {
  entities?: Record<string, EntityHooks>;
  routes?: (app: Hono) => void;
  /**
   * Captcha or challenge check (Turnstile, hCaptcha, reCAPTCHA, your own) for
   * signup and signed out creates. Runs before the request body is used.
   */
  verify?: (ctx: VerifyContext) => Promise<VerifyHookResult> | VerifyHookResult;
}
