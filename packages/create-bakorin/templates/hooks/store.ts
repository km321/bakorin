import { createHmac, timingSafeEqual } from "node:crypto";
import type { BakorinHooks, HookContext } from "@bakorin/server";

// Store with Stripe Checkout (one time payments).
//
// 1. A shopper places an order. lines, totalCents, and checkoutUrl are writable: none in
//    app.yaml, so only this file sets them: right after the order is saved it copies the
//    cart with the current prices, checks stock, and opens a Stripe Checkout Session.
// 2. The checkout page links to Stripe. Stripe sends the shopper back to /checkout/<id>.
// 3. Stripe calls POST /stripe/webhook. Only a verified checkout.session.completed whose
//    session, amount, and currency match the order marks it paid, takes the stock, and
//    queues the receipt email. Each event id is applied once.
//
// Without STRIPE_SECRET_KEY the store still works and orders wait for payment.

const CURRENCY = (process.env.STORE_CURRENCY || "usd").toLowerCase();

interface OrderLine {
  productId: string;
  name: string;
  quantity: number;
  unitCents: number | null;
}

function parseLines(value: unknown): OrderLine[] {
  if (Array.isArray(value)) return value as OrderLine[];
  if (typeof value === "string" && value) {
    try {
      return JSON.parse(value) as OrderLine[];
    } catch {
      return [];
    }
  }
  return [];
}

function money(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: CURRENCY.toUpperCase() }).format(cents / 100);
}

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

function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
// --------------------------------------------------------------------------- end Stripe

async function setOrder(db: AppDb, orderId: string, values: Record<string, unknown>) {
  await db.updateTable("orders").set({ ...values, updatedAt: new Date().toISOString() }).where("id", "=", orderId).execute();
}

const hooks: BakorinHooks = {
  entities: {
    orders: {
      async afterCreate({ record, db }) {
        const orderId = String(record.id);
        const ownerId = String(record.ownerId);
        const items = await db
          .selectFrom("cartItems")
          .innerJoin("products", "products.id", "cartItems.productId")
          .select(["cartItems.productId as productId", "cartItems.quantity as quantity", "products.name as name", "products.priceCents as priceCents", "products.stock as stock"])
          .where("cartItems.ownerId", "=", ownerId)
          .execute();
        const lines: OrderLine[] = items.map((item) => ({
          productId: String(item.productId),
          name: String(item.name),
          quantity: Math.max(1, Number(item.quantity ?? 1)),
          unitCents: item.priceCents === null || item.priceCents === undefined ? null : Number(item.priceCents),
        }));
        const totalCents = lines.reduce((sum, line) => sum + (line.unitCents ?? 0) * line.quantity, 0);
        const owner = await db.selectFrom("users").select(["email"]).where("id", "=", ownerId).executeTakeFirst();
        const email = owner?.email ? String(owner.email) : null;
        await setOrder(db, orderId, { lines: JSON.stringify(lines), totalCents, email });
        await db.deleteFrom("cartItems").where("ownerId", "=", ownerId).execute();

        // Reasons the order cannot be paid yet. They show on the checkout page.
        const short = items.find((item) => item.stock !== null && item.stock !== undefined && Number(item.stock) < Number(item.quantity ?? 1));
        let note = "";
        if (lines.length === 0) note = "This order has no items.";
        else if (lines.some((line) => line.unitCents === null)) note = "Some items have no price yet, so this order cannot be paid. An admin can set prices on the Manage page.";
        else if (short) note = `Only ${Number(short.stock)} left of ${String(short.name)}.`;
        else if (!process.env.STRIPE_SECRET_KEY) note = "Payments are not set up yet. Add STRIPE_SECRET_KEY to take test payments.";
        if (note) {
          await setOrder(db, orderId, { note });
          return;
        }
        try {
          const session = await stripeRequest<{ id: string; url: string }>(
            "/v1/checkout/sessions",
            {
              mode: "payment",
              client_reference_id: orderId,
              customer_email: email ?? undefined,
              success_url: `${siteUrl()}/checkout/${orderId}?paid=1`,
              cancel_url: `${siteUrl()}/checkout/${orderId}`,
              metadata: { orderId },
              payment_intent_data: { metadata: { orderId } },
              line_items: lines.map((line) => ({
                quantity: line.quantity,
                price_data: { currency: CURRENCY, unit_amount: line.unitCents, product_data: { name: line.name } },
              })),
            },
            `checkout-${orderId}`,
          );
          await setOrder(db, orderId, { stripeSessionId: session.id, checkoutUrl: session.url });
        } catch (error) {
          console.error(`[store] could not open Stripe Checkout for order ${orderId}: ${error instanceof Error ? error.message : error}`);
          await setOrder(db, orderId, { note: "Checkout could not be opened. Please try again in a moment." });
        }
      },
    },
  },

  routes(app) {
    stripeWebhookRoute(
      app,
      {
        async "checkout.session.completed"(event, trx) {
          const session = event.data.object;
          const orderId = String(session.metadata?.orderId ?? session.client_reference_id ?? "");
          const order = orderId ? await trx.selectFrom("orders").selectAll().where("id", "=", orderId).executeTakeFirst() : undefined;
          // Trust nothing but a session this server opened for this exact amount.
          if (!order || order.stripeSessionId !== session.id) return;
          if (order.status !== "pending_payment" || session.payment_status !== "paid") return;
          if (Number(session.amount_total) !== Number(order.totalCents) || String(session.currency).toLowerCase() !== CURRENCY) {
            console.error(`[store] order ${orderId}: Stripe amount ${session.amount_total} ${session.currency} does not match ${order.totalCents} ${CURRENCY}; not marked paid`);
            return;
          }
          const now = new Date().toISOString();
          await setOrder(trx, orderId, { status: "paid", paidAt: now });
          for (const line of parseLines(order.lines)) {
            await trx
              .updateTable("products")
              .set((eb) => ({ stock: eb("stock", "-", line.quantity), updatedAt: now }))
              .where("id", "=", line.productId)
              .where("stock", "is not", null)
              .execute();
          }
        },
        async "checkout.session.expired"(event, trx) {
          const session = event.data.object;
          const orderId = String(session.metadata?.orderId ?? "");
          const order = orderId ? await trx.selectFrom("orders").select(["status", "stripeSessionId"]).where("id", "=", orderId).executeTakeFirst() : undefined;
          if (order && order.stripeSessionId === session.id && order.status === "pending_payment") {
            await setOrder(trx, orderId, { status: "cancelled", checkoutUrl: null, note: "The checkout expired. Place the order again to pay." });
          }
        },
      },
      async (event, ctx) => {
        if (event.type !== "checkout.session.completed") return;
        const orderId = String(event.data.object.metadata?.orderId ?? "");
        const order = await ctx.db.selectFrom("orders").selectAll().where("id", "=", orderId).executeTakeFirst();
        if (!order || order.status !== "paid" || !order.email) return;
        const lines = parseLines(order.lines);
        const rows = lines.map((line) => `<tr><td>${escapeHtml(line.name)}</td><td>${line.quantity}</td><td>${money((line.unitCents ?? 0) * line.quantity)}</td></tr>`).join("");
        const number = orderId.slice(0, 8).toUpperCase();
        // The outbox retries on its own; the key stops a second receipt for the same order.
        await ctx.mail.send({
          to: String(order.email),
          subject: `Receipt for order ${number}`,
          html: `<h1>Thanks for your order</h1><p>Order ${number} is paid.</p><table><thead><tr><th>Item</th><th>Qty</th><th>Total</th></tr></thead><tbody>${rows}</tbody></table><p><strong>Total: ${money(Number(order.totalCents))}</strong></p><p><a href="${escapeHtml(`${siteUrl()}/orders`)}">See your orders</a></p>`,
          text: `Thanks for your order. Order ${number} is paid.\n\n${lines.map((line) => `${line.name} x ${line.quantity}: ${money((line.unitCents ?? 0) * line.quantity)}`).join("\n")}\n\nTotal: ${money(Number(order.totalCents))}\n${siteUrl()}/orders`,
          idempotencyKey: `receipt-${orderId}`,
        });
      },
    );
  },
};

export default hooks;
