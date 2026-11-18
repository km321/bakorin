import { createHmac, timingSafeEqual } from "node:crypto";
import type { BakorinHooks, HookContext } from "@bakorin/server";

// Membership with Stripe subscriptions.
//
// 1. A signed in user picks a plan. /join/<plan id> creates a membershipCheckouts row; right
//    after it is saved this file opens a Stripe Checkout Session in subscription mode.
// 2. Stripe calls POST /stripe/webhook. Verified subscription events set the user's role to
//    the plan tier (basic or pro), or back to user when the subscription ends. app.yaml uses
//    the role to gate lessons (members) and masterclasses (Pro). Each event id applies once.
// 3. /billing/<id> creates a portalSessions row; this file opens the Stripe customer portal.
//
// Roles live in the session token, so pages send members through the refresh route after
// checkout to pick up the new role. Without STRIPE_SECRET_KEY the app runs and says so.

type Tier = "basic" | "pro";
const LIVE = new Set(["active", "trialing", "past_due"]);

// ---------------------------------------------------------------------------
// Stripe, with no SDK: two small helpers that call the Stripe API and check webhook
// signatures. Test mode keys only while you build (sk_test_..., whsec_...).
//   STRIPE_SECRET_KEY       secret key, server only
//   STRIPE_WEBHOOK_SECRET   signing secret of the webhook endpoint (or of `stripe listen`)
//   SITE_URL                your site, for the pages Stripe sends shoppers back to
// ---------------------------------------------------------------------------
function stripeApiBase(): string {
  return process.env.STRIPE_API_BASE || "https://api.stripe.com";
}

function siteUrl(): string {
  return (process.env.SITE_URL || process.env.APP_URL || "http://localhost:4321").replace(/\/$/, "");
}

/** Stripe takes form fields, with nested keys written like line_items[0][price_data][currency]. */
function formBody(params: Record<string, unknown>, prefix = "", out = new URLSearchParams()): URLSearchParams {
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    const name = prefix ? `${prefix}[${key}]` : key;
    if (typeof value === "object") formBody(value as Record<string, unknown>, name, out);
    else out.append(name, String(value));
  }
  return out;
}

async function stripeRequest<T = Record<string, unknown>>(path: string, params: Record<string, unknown>, idempotencyKey?: string): Promise<T> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  const response = await fetch(`${stripeApiBase()}${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/x-www-form-urlencoded",
      ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
    },
    body: formBody(params),
  });
  const json = (await response.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(`Stripe ${path} failed (${response.status}): ${json.error?.message ?? "no message"}`);
  return json;
}

/**
 * Checks the Stripe-Signature header (t=timestamp,v1=hmac) the way Stripe documents it:
 * HMAC-SHA256 of "timestamp.rawBody" with the endpoint secret, compared in constant
 * time, and refused when the timestamp is more than 5 minutes off.
 */
function verifyStripeSignature(payload: string, header: string | undefined, secret: string, toleranceSeconds = 300): boolean {
  if (!header) return false;
  let timestamp = "";
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const [k, v] = part.split("=", 2);
    if (k?.trim() === "t" && v) timestamp = v.trim();
    if (k?.trim() === "v1" && v) signatures.push(v.trim());
  }
  const seconds = Number(timestamp);
  if (!timestamp || !Number.isInteger(seconds) || signatures.length === 0) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - seconds) > toleranceSeconds) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex"), "utf8");
  return signatures.some((signature) => {
    const given = Buffer.from(signature, "utf8");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

interface StripeEvent {
  id: string;
  type: string;
  data: { object: Record<string, any> };
}

type AppDb = HookContext["db"];
type RoutesApp = Parameters<NonNullable<BakorinHooks["routes"]>>[0];
type AppCtx = Pick<HookContext, "db" | "mail">;

/**
 * Runs handle() once per Stripe event id. The event row and the changes commit in one
 * transaction, so a retried or replayed event is a no op.
 */
async function onceForEvent(db: AppDb, event: StripeEvent, handle: (trx: AppDb) => Promise<void>): Promise<"done" | "duplicate"> {
  const seen = await db.selectFrom("stripeEvents").select("id").where("eventId", "=", event.id).executeTakeFirst();
  if (seen) return "duplicate";
  try {
    await db.transaction().execute(async (trx) => {
      const now = new Date().toISOString();
      await trx.insertInto("stripeEvents").values({ id: crypto.randomUUID(), eventId: event.id, type: event.type, createdAt: now, updatedAt: now }).execute();
      await handle(trx as unknown as AppDb);
    });
  } catch (error) {
    // Two deliveries at once: the unique eventId lets one through.
    const raced = await db.selectFrom("stripeEvents").select("id").where("eventId", "=", event.id).executeTakeFirst();
    if (raced) return "duplicate";
    throw error;
  }
  return "done";
}

/** POST /stripe/webhook: verified events only. Point Stripe (or `stripe listen --forward-to`) here. */
function stripeWebhookRoute(app: RoutesApp, handlers: Record<string, (event: StripeEvent, trx: AppDb) => Promise<void>>, after?: (event: StripeEvent, ctx: AppCtx) => Promise<void>) {
  app.post("/stripe/webhook", async (c) => {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) return c.json({ error: { code: "not_configured", message: "STRIPE_WEBHOOK_SECRET is not set" } }, 503);
    const payload = await c.req.text();
    if (!verifyStripeSignature(payload, c.req.header("stripe-signature"), secret)) {
      return c.json({ error: { code: "bad_signature", message: "Stripe signature check failed" } }, 400);
    }
    let event: StripeEvent;
    try {
      event = JSON.parse(payload) as StripeEvent;
    } catch {
      return c.json({ error: { code: "bad_payload", message: "invalid JSON" } }, 400);
    }
    const handler = handlers[event.type];
    if (!handler || typeof event.id !== "string") return c.json({ received: true, ignored: true });
    const result = await onceForEvent(c.get("app").db, event, (trx) => handler(event, trx));
    if (result === "done" && after) await after(event, c.get("app"));
    return c.json({ received: true, duplicate: result === "duplicate" });
  });
}

// --------------------------------------------------------------------------- end Stripe

interface StripeSubscription {
  id: string;
  customer: string;
  status: string;
  current_period_end?: number;
  metadata?: Record<string, string>;
  items?: { data?: { price?: { id?: string }; current_period_end?: number }[] };
}

async function userForSubscription(db: AppDb, sub: StripeSubscription) {
  const byId = sub.metadata?.userId ? await db.selectFrom("users").select(["id", "role"]).where("id", "=", sub.metadata.userId).executeTakeFirst() : undefined;
  if (byId) return byId;
  return db.selectFrom("users").select(["id", "role"]).where("stripeCustomerId", "=", String(sub.customer)).executeTakeFirst();
}

async function tierForSubscription(db: AppDb, sub: StripeSubscription): Promise<Tier | null> {
  const priceId = sub.items?.data?.[0]?.price?.id;
  if (priceId) {
    const plan = await db.selectFrom("plans").select(["tier"]).where("stripePriceId", "=", priceId).executeTakeFirst();
    if (plan) return plan.tier as Tier;
  }
  const tier = sub.metadata?.tier;
  return tier === "basic" || tier === "pro" ? tier : null;
}

async function applySubscription(db: AppDb, sub: StripeSubscription, deleted = false) {
  const user = await userForSubscription(db, sub);
  if (!user) return;
  const tier = deleted ? null : await tierForSubscription(db, sub);
  const live = !deleted && LIVE.has(sub.status) && tier !== null;
  const end = sub.current_period_end ?? sub.items?.data?.[0]?.current_period_end;
  // Admins keep their role; everyone else gets the plan tier while the subscription is live.
  const role = user.role === "admin" ? "admin" : live ? tier : "user";
  await db
    .updateTable("users")
    .set({
      role,
      subscriptionStatus: deleted ? "canceled" : sub.status,
      currentPeriodEnd: end ? new Date(end * 1000).toISOString() : null,
      stripeCustomerId: String(sub.customer),
      stripeSubscriptionId: deleted ? null : sub.id,
      updatedAt: new Date().toISOString(),
    })
    .where("id", "=", String(user.id))
    .execute();
}

async function customerFor(db: AppDb, userId: string): Promise<string> {
  const user = await db.selectFrom("users").select(["email", "name", "stripeCustomerId"]).where("id", "=", userId).executeTakeFirstOrThrow();
  if (user.stripeCustomerId) return String(user.stripeCustomerId);
  const customer = await stripeRequest<{ id: string }>(
    "/v1/customers",
    { email: String(user.email), name: user.name ? String(user.name) : undefined, metadata: { userId } },
    `customer-${userId}`,
  );
  await db.updateTable("users").set({ stripeCustomerId: customer.id }).where("id", "=", userId).execute();
  return customer.id;
}

function setupNote(): string {
  return "Payments are not set up yet. Add STRIPE_SECRET_KEY to take test payments.";
}

const hooks: BakorinHooks = {
  entities: {
    membershipCheckouts: {
      async afterCreate({ record, db }) {
        const id = String(record.id);
        const userId = String(record.ownerId);
        const plan = await db.selectFrom("plans").selectAll().where("id", "=", String(record.planId)).executeTakeFirst();
        const done = (values: Record<string, unknown>) => db.updateTable("membershipCheckouts").set(values).where("id", "=", id).execute();
        if (!plan || !plan.active) return void (await done({ note: "That plan is not available." }));
        if (!plan.stripePriceId) return void (await done({ note: "This plan has no Stripe Price yet. An admin can add one in the admin." }));
        if (!process.env.STRIPE_SECRET_KEY) return void (await done({ note: setupNote() }));
        try {
          const customer = await customerFor(db, userId);
          const metadata = { userId, tier: String(plan.tier), planId: String(plan.id) };
          const session = await stripeRequest<{ url: string }>(
            "/v1/checkout/sessions",
            {
              mode: "subscription",
              customer,
              client_reference_id: userId,
              line_items: [{ price: String(plan.stripePriceId), quantity: 1 }],
              success_url: `${siteUrl()}/account?joined=1`,
              cancel_url: `${siteUrl()}/`,
              metadata,
              subscription_data: { metadata },
            },
            `membership-checkout-${id}`,
          );
          await done({ checkoutUrl: session.url });
        } catch (error) {
          console.error(`[membership] could not open Stripe Checkout: ${error instanceof Error ? error.message : error}`);
          await done({ note: "Checkout could not be opened. Please try again in a moment." });
        }
      },
    },
    portalSessions: {
      async afterCreate({ record, db }) {
        const id = String(record.id);
        const done = (values: Record<string, unknown>) => db.updateTable("portalSessions").set(values).where("id", "=", id).execute();
        if (!process.env.STRIPE_SECRET_KEY) return void (await done({ note: setupNote() }));
        const user = await db.selectFrom("users").select(["stripeCustomerId"]).where("id", "=", String(record.ownerId)).executeTakeFirst();
        if (!user?.stripeCustomerId) return void (await done({ note: "You do not have a subscription yet." }));
        try {
          const portal = await stripeRequest<{ url: string }>(
            "/v1/billing_portal/sessions",
            { customer: String(user.stripeCustomerId), return_url: `${siteUrl()}/account` },
            `portal-${id}`,
          );
          await done({ url: portal.url });
        } catch (error) {
          console.error(`[membership] could not open the billing portal: ${error instanceof Error ? error.message : error}`);
          await done({ note: "The billing portal could not be opened. Please try again in a moment." });
        }
      },
    },
  },

  routes(app) {
    stripeWebhookRoute(app, {
      async "checkout.session.completed"(event, trx) {
        // Links the Stripe customer to the user. The subscription events set the role.
        const session = event.data.object;
        if (session.mode !== "subscription" || !session.customer) return;
        const userId = String(session.metadata?.userId ?? session.client_reference_id ?? "");
        if (userId) await trx.updateTable("users").set({ stripeCustomerId: String(session.customer) }).where("id", "=", userId).execute();
      },
      async "customer.subscription.created"(event, trx) {
        await applySubscription(trx, event.data.object as unknown as StripeSubscription);
      },
      async "customer.subscription.updated"(event, trx) {
        await applySubscription(trx, event.data.object as unknown as StripeSubscription);
      },
      async "customer.subscription.deleted"(event, trx) {
        await applySubscription(trx, event.data.object as unknown as StripeSubscription, true);
      },
    });
  },
};

export default hooks;
