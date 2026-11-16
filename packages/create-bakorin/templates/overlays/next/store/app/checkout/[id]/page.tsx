import Link from "next/link";
import { notFound } from "next/navigation";
import { api } from "../../../lib/bakorin.ts";
import { money, orderLines, orderNumber, STATUS_LABELS } from "../../../lib/store.ts";

export const metadata = { title: "Checkout" };

export default async function CheckoutPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const order = await (await api()).entity("orders").get(id).catch(() => null);
  if (!order) notFound();
  const lines = orderLines(order);
  // hooks.ts fills lines and totalCents right after the order is saved.
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
        <div className="notice">
          <p>
            <strong>Payments are not connected yet.</strong> This is a placeholder. No card is charged and the order stays waiting for payment.
          </p>
          <p>
            To take payments, connect a provider here: create a checkout session for this order on the server, and have the provider&apos;s webhook mark the order paid. Only
            the server should set the status and amount.
          </p>
        </div>
      </section>
      <p>
        <Link href="/orders">See all your orders</Link>
      </p>
    </>
  );
}
