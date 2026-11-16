import Link from "next/link";
import { api, relatedOf } from "../../lib/bakorin.ts";
import { money, type Product } from "../../lib/store.ts";
import { placeOrder, removeCartItem, updateCartItem } from "../store-actions.ts";

export const metadata = { title: "Cart" };

export default async function CartPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  // middleware.ts protects /cart. Cart rows are private to their owner in app.yaml.
  const { error } = await searchParams;
  const { data: items } = await (await api()).entity("cartItems").list({ expand: "productId", sort: "createdAt", limit: 100 });
  const rows = items.map((item) => {
    const product = relatedOf<Product>(item, "productId");
    const unit = product?.priceCents ?? null;
    return { item, product, unit, line: unit === null ? null : unit * (item.quantity ?? 1) };
  });
  const unpriced = rows.some((row) => row.unit === null);
  const total = rows.reduce((sum, row) => sum + (row.line ?? 0), 0);
  return (
    <section className="card">
      <h1>Your cart</h1>
      {error ? (
        <div className="error" role="alert">
          {error}
        </div>
      ) : null}
      {rows.length === 0 ? (
        <p className="empty">
          Your cart is empty. <Link href="/">Browse the shop</Link>.
        </p>
      ) : (
        <>
          <table className="rows">
            <caption className="bk-visually-hidden">Items in your cart</caption>
            <thead>
              <tr>
                <th scope="col">Product</th>
                <th scope="col">Price</th>
                <th scope="col">Quantity</th>
                <th scope="col">Total</th>
                <th scope="col">
                  <span className="bk-visually-hidden">Remove</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ item, product, unit, line }) => (
                <tr key={item.id}>
                  <td data-label="Product">{product ? <Link href={`/products/${product.slug}`}>{product.name}</Link> : "Removed product"}</td>
                  <td data-label="Price">{money(unit)}</td>
                  <td data-label="Quantity">
                    <form action={updateCartItem} className="inline-form">
                      <input type="hidden" name="id" value={item.id} />
                      <input type="number" name="quantity" min="0" max="99" defaultValue={item.quantity ?? 1} aria-label={`Quantity of ${product?.name ?? "item"}`} />
                      <button type="submit" className="secondary">
                        Update
                      </button>
                    </form>
                  </td>
                  <td data-label="Total">{line === null ? "None" : money(line)}</td>
                  <td className="rows-action">
                    <form action={removeCartItem} className="inline-form">
                      <input type="hidden" name="id" value={item.id} />
                      <button type="submit" className="secondary" aria-label={`Remove ${product?.name ?? "item"}`}>
                        Remove
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p>
            <strong>Total: {money(total)}</strong>
          </p>
          {unpriced && <p className="notice">Some items have no price yet, so they are not in the total. An admin can set prices on the Manage page.</p>}
          <form action={placeOrder}>
            <button type="submit">Place order</button>
          </form>
        </>
      )}
    </section>
  );
}
