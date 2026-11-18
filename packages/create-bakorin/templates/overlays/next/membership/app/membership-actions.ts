"use server";

import { redirect } from "next/navigation";
import { api } from "../lib/bakorin.ts";
import { settle } from "../lib/membership.ts";

function problem(message: string): string {
  return encodeURIComponent(message);
}

/** Starts a subscription. hooks.ts opens Stripe Checkout and saves its address. */
export async function joinPlan(formData: FormData): Promise<void> {
  const planId = String(formData.get("planId") ?? "");
  let target = "";
  try {
    const client = await api();
    const { id } = await client.entity("membershipCheckouts").create({ planId });
    const checkout = await settle(() => client.entity("membershipCheckouts").get(id), (row) => Boolean(row.checkoutUrl || row.note));
    target = checkout.checkoutUrl ? checkout.checkoutUrl : `/join/${planId}?error=${problem(checkout.note || "Checkout could not be opened.")}`;
  } catch (error) {
    target = `/join/${planId}?error=${problem(error instanceof Error ? error.message : "Could not start checkout")}`;
  }
  redirect(target);
}

/** Opens the Stripe customer portal: change plan, card, or cancel. */
export async function openBilling(): Promise<void> {
  let target = "";
  try {
    const client = await api();
    const { id } = await client.entity("portalSessions").create({});
    const portal = await settle(() => client.entity("portalSessions").get(id), (row) => Boolean(row.url || row.note));
    target = portal.url ? portal.url : `/account?error=${problem(portal.note || "The billing portal could not be opened.")}`;
  } catch (error) {
    target = `/account?error=${problem(error instanceof Error ? error.message : "Could not open billing")}`;
  }
  redirect(target);
}
