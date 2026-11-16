import Link from "next/link";
import { api, imageOf } from "../lib/bakorin.ts";
import { money, type Product } from "../lib/store.ts";

export const metadata = { title: "Shop" };
export const dynamic = "force-dynamic";

export default async function ShopPage() {
  // Products are public in app.yaml, so this works signed out too.
  const { data: products } = await (await api()).entity("products").list({ filter: { active: true }, sort: "name", limit: 48, expand: "image" });
  return (
    <section className="section">
      <h1>Shop</h1>
      {products.length === 0 ? (
        <p className="empty">No products yet. Admins can add them on the Manage page, or run bun seed.ts for example products.</p>
      ) : (
        <ul className="grid">
          {products.map((product: Product) => {
            const image = imageOf(product, "image");
            return (
              <li key={product.id} className="tile">
                {image ? (
                  <img className="media" src={image} alt={product.imageAlt ?? ""} loading="lazy" />
                ) : (
                  <div className="media media-placeholder" aria-hidden="true">
                    No photo
                  </div>
                )}
                <div className="tile-body">
                  <h2>
                    <Link href={`/products/${product.slug}`}>{product.name}</Link>
                  </h2>
                  <p className="meta">{money(product.priceCents)}</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
