import type { Lessons, Masterclasses, Plans, Users } from "./bakorin.gen.ts";

export type Plan = Plans;
export type Lesson = Lessons;
export type Masterclass = Masterclasses;
export type Member = Users;

/** Set this to your currency. Stripe charges the plan's Price, so keep them in step. */
export const CURRENCY = "USD";

export function planPrice(plan: Pick<Plan, "priceCents" | "interval">): string {
  if (plan.priceCents === null || plan.priceCents === undefined) return "Price not set";
  const amount = new Intl.NumberFormat("en-US", { style: "currency", currency: CURRENCY }).format(plan.priceCents / 100);
  return `${amount} per ${plan.interval ?? "month"}`;
}

/** Roles that come from a plan. app.yaml gates content with role(basic) and role(pro). */
export const TIER_LABELS: Record<string, string> = { user: "No plan", basic: "Basic", pro: "Pro", admin: "Admin" };

export function isMember(role: unknown): boolean {
  return role === "basic" || role === "pro" || role === "admin";
}

export function isPro(role: unknown): boolean {
  return role === "pro" || role === "admin";
}

/**
 * hooks.ts fills in a checkout or portal address just after the row is saved (after hooks
 * run once the write commits), so read the row until it has one. About 6 seconds at most.
 */
export async function settle<T>(load: () => Promise<T>, done: (row: T) => boolean): Promise<T> {
  let row = await load();
  for (let i = 0; i < 30 && !done(row); i++) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    row = await load();
  }
  return row;
}
