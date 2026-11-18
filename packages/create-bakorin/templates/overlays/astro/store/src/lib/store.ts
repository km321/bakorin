import type { CartItems, Orders, Products } from "./bakorin.gen.ts";

export type Product = Products;
export type CartItem = CartItems;
export type Order = Orders;

/** Set this to your store's currency. */
export const CURRENCY = "USD";

export const PRODUCT_FIELDS = ["name", "slug", "description", "priceCents", "stock", "image", "imageAlt", "active"];

/** Cents as money, or a clear note when no price is set yet. */
export function money(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "Price not set";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: CURRENCY }).format(cents / 100);
}

/** One line of an order, as hooks.ts stores it. */
export interface OrderLine {
  productId: string;
  name: string;
  quantity: number;
  unitCents: number | null;
}

/** lines is a json field: hooks.ts stores the cart there as a list. */
export function orderLines(order: Pick<Order, "lines">): OrderLine[] {
  return Array.isArray(order.lines) ? (order.lines as unknown as OrderLine[]) : [];
}

export const STATUS_LABELS: Record<string, string> = {
  pending_payment: "Waiting for payment",
  paid: "Paid",
  cancelled: "Cancelled",
};

/** A short, readable order number from the id. */
export function orderNumber(id: string): string {
  return id.slice(0, 8).toUpperCase();
}
