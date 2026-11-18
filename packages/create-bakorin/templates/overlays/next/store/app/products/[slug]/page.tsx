import Link from "next/link";
import { notFound } from "next/navigation";
import { api, currentUser, imageOf } from "../../../lib/bakorin.ts";
import { money } from "../../../lib/store.ts";
import { RichText } from "@bakorin/sdk/react";
import { addToCart } from "../../store-actions.ts";

async function findProduct(slug: string) {
  const { data } = await (await api()).entity("products").list({ filter: { slug, active: true }, limit: 1, expand: "image" });
  return data[0];
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  return { title: (await findProduct((await params).slug))?.name ?? "Not found" };
}

export default async function ProductPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ error?: string }> }) {
  const [product, user, { error }] = await Promise.all([findProduct((await params).slug), currentUser(), searchParams]);
  if (!product) notFound();
  const image = imageOf(product, "image");
  return (
    <>
      <div className="split">
        <section className="card">
          {image ? <img className="media" src={image} alt={product.imageAlt ?? ""} /> : null}
          <h1>{product.name}</h1>
          <p className="meta">{money(product.priceCents)}</p>
          {product.description ? <RichText html={product.description} className="prose" /> : null}
          {product.stock !== null && product.stock !== undefined ? <p className="meta">{product.stock > 0 ? `${product.stock} in stock` : "Sold out"}</p> : null}
        </section>
        <section className="card">
          <h2>Buy</h2>
          {error ? (
            <div className="error" role="alert">
              {error}
            </div>
          ) : null}
          {user ? (
            <form action={addToCart}>
              <input type="hidden" name="productId" value={product.id} />
              <input type="hidden" name="slug" value={product.slug} />
              <label>
                Quantity
                <input type="number" name="quantity" min="1" max="99" defaultValue="1" />
              </label>
              <button type="submit">Add to cart</button>
            </form>
          ) : (
            <p>
              <Link href="/login">Sign in</Link> to add this to your cart.
            </p>
          )}
        </section>
      </div>
      <p>
        <Link href="/">Back to the shop</Link>
      </p>
    </>
  );
}
