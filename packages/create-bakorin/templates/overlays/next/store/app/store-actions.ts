"use server";

import { redirect } from "next/navigation";
import { api, currentUser } from "../lib/bakorin.ts";

function problem(error: unknown, fallback: string): string {
  return encodeURIComponent(error instanceof Error ? error.message : fallback);
}

/** Adds a product to the signed in shopper's cart (one row per product). */
export async function addToCart(formData: FormData): Promise<void> {
  const productId = String(formData.get("productId") ?? "");
  const slug = String(formData.get("slug") ?? "");
  if (!(await currentUser())) redirect("/login");
  const quantity = Math.max(1, Math.min(99, Number(formData.get("quantity") ?? 1) || 1));
  const client = await api();
  try {
    const { data: existing } = await client.entity("cartItems").list({ filter: { productId }, limit: 1 });
    if (existing[0]) {
      await client.entity("cartItems").update(existing[0].id, { quantity: (existing[0].quantity ?? 1) + quantity });
    } else {
      await client.entity("cartItems").create({ productId, quantity });
    }
  } catch (error) {
    redirect(`/products/${slug}?error=${problem(error, "Could not add to the cart")}`);
  }
  redirect("/cart");
}

/** Sets a cart row's quantity; 0 removes it. */
export async function updateCartItem(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  const quantity = Math.max(0, Math.min(99, Number(formData.get("quantity") ?? 1) || 0));
  const client = await api();
  try {
    if (quantity === 0) await client.entity("cartItems").delete(id);
    else await client.entity("cartItems").update(id, { quantity });
  } catch (error) {
    redirect(`/cart?error=${problem(error, "Could not update the cart")}`);
  }
  redirect("/cart");
}

export async function removeCartItem(formData: FormData): Promise<void> {
  try {
    await (await api()).entity("cartItems").delete(String(formData.get("id") ?? ""));
  } catch (error) {
    redirect(`/cart?error=${problem(error, "Could not update the cart")}`);
  }
  redirect("/cart");
}

/** Creates the order. hooks.ts copies the cart into it with the current prices, then empties the cart. */
export async function placeOrder(): Promise<void> {
  let id = "";
  try {
    id = (await (await api()).entity("orders").create({})).id;
  } catch (error) {
    redirect(`/cart?error=${problem(error, "Could not place the order")}`);
  }
  redirect(`/checkout/${id}`);
}
