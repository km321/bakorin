import Link from "next/link";
import { notFound } from "next/navigation";
import { api } from "../../../lib/bakorin.ts";
import { money, orderLines, orderNumber, STATUS_LABELS } from "../../../lib/store.ts";

export const metadata = { title: "Checkout" };

export default async function CheckoutPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ paid?: string }> }) {
  const { id } = await params;
  const backFromStripe = (await searchParams).paid === "1";
  const order = await (await api()).entity("orders").get(id).catch(() => null);
  if (!order) notFound();
  const lines = orderLines(order);
  // hooks.ts fills lines and totalCents right after the order is saved, then opens Stripe Checkout.
  const ready = order.totalCents !== undefined && order.totalCents !== null;
  return (
    <>
      <section className="card">
        <h1>Order {orderNumber(order.id)}</h1>
        <p className="meta">{STATUS_LABELS[order.status] ?? order.status}</p>
        {ready ? (
          <>
            <table className="rows">
              <caption className="bk-visually-hidden">Items in this order</caption>
              <thead>
                <tr>
                  <th scope="col">Product</th>
                  <th scope="col">Quantity</th>
                  <th scope="col">Price</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => (
                  <tr key={line.productId}>
                    <td data-label="Product">{line.name}</td>
                    <td data-label="Quantity">{line.quantity}</td>
                    <td data-label="Price">{money(line.unitCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p>
              <strong>Total: {money(order.totalCents)}</strong>
            </p>
          </>
        ) : (
          <p className="notice" role="status">
            Adding up your order. <Link href={`/checkout/${order.id}`}>Refresh</Link> in a moment.
          </p>
        )}
      </section>
      <section className="card" aria-labelledby="payment-heading">
        <h2 id="payment-heading">Payment</h2>
        {order.status === "paid" ? (
          <p className="notice" role="status">
            <strong>Paid.</strong> Thank you. A receipt is on its way to {order.email}.
          </p>
        ) : order.status === "cancelled" ? (
          <p className="notice">{order.note || "This order was cancelled."}</p>
        ) : backFromStripe ? (
          <p className="notice" role="status">
            Thanks. We are confirming your payment with Stripe. <Link href={`/checkout/${order.id}?paid=1`}>Refresh</Link> in a moment.
          </p>
        ) : order.note ? (
          <p className="notice">{order.note}</p>
        ) : order.checkoutUrl ? (
          <>
            <p>You will pay on Stripe&apos;s secure checkout page, then come back here.</p>
            <p>
              <a className="button" href={order.checkoutUrl}>
                Pay {money(order.totalCents)} with Stripe
              </a>
            </p>
          </>
        ) : (
          <p className="notice" role="status">
            Opening checkout. <Link href={`/checkout/${order.id}`}>Refresh</Link> in a moment.
          </p>
        )}
      </section>
      <p>
        <Link href="/orders">See all your orders</Link>
      </p>
    </>
  );
}
