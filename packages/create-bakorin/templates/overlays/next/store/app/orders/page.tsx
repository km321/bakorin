import Link from "next/link";
import { api } from "../../lib/bakorin.ts";
import { money, orderNumber, STATUS_LABELS } from "../../lib/store.ts";

export const metadata = { title: "Orders" };

export default async function OrdersPage() {
  // Orders are private to their owner (and admins) in app.yaml.
  const { data: orders } = await (await api()).entity("orders").list({ sort: "-createdAt", limit: 50 });
  return (
    <section className="card">
      <h1>Your orders</h1>
      {orders.length === 0 ? (
        <p className="empty">No orders yet.</p>
      ) : (
        <table className="rows">
          <caption className="bk-visually-hidden">Your orders</caption>
          <thead>
            <tr>
              <th scope="col">Order</th>
              <th scope="col">Placed</th>
              <th scope="col">Status</th>
              <th scope="col">Total</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => (
              <tr key={order.id}>
                <td>
                  <Link href={`/checkout/${order.id}`}>{orderNumber(order.id)}</Link>
                </td>
                <td>{new Date(order.createdAt).toLocaleDateString("en-US")}</td>
                <td>{STATUS_LABELS[order.status] ?? order.status}</td>
                <td>{money(order.totalCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
