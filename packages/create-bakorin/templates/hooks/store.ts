import type { BakorinHooks } from "@bakorin/server";

// Orders: lines and totalCents are writable: none in app.yaml, so shoppers can never
// set them. Right after an order is saved, this copies the shopper's cart into it with
// the current prices and empties the cart. The order page shows "Adding up your order"
// until this has run (usually a few milliseconds).
//
// Payments are not connected. When you add a provider, create its checkout session in a
// custom route below and let the provider's webhook set status to paid.
const hooks: BakorinHooks = {
  entities: {
    orders: {
      async afterCreate({ record, db }) {
        const orderId = String(record.id);
        const ownerId = String(record.ownerId);
        const items = await db
          .selectFrom("cartItems")
          .innerJoin("products", "products.id", "cartItems.productId")
          .select(["cartItems.productId as productId", "cartItems.quantity as quantity", "products.name as name", "products.priceCents as priceCents"])
          .where("cartItems.ownerId", "=", ownerId)
          .execute();
        const lines = items.map((item) => ({
          productId: String(item.productId),
          name: String(item.name),
          quantity: Number(item.quantity ?? 1),
          unitCents: item.priceCents === null || item.priceCents === undefined ? null : Number(item.priceCents),
        }));
        // Items without a price are listed but not charged.
        const totalCents = lines.reduce((sum, line) => sum + (line.unitCents ?? 0) * line.quantity, 0);
        await db
          .updateTable("orders")
          .set({ lines: JSON.stringify(lines), totalCents, updatedAt: new Date().toISOString() })
          .where("id", "=", orderId)
          .execute();
        await db.deleteFrom("cartItems").where("ownerId", "=", ownerId).execute();
      },
    },
  },
};

export default hooks;
