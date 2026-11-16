import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@bakorin/sdk/next";
import { api, hasRole, type User } from "../../../lib/bakorin.ts";
import { ProductForm } from "./product-form.tsx";

export const metadata = { title: "Edit product" };

export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  const client = await api();
  const { id } = await params;
  const user = await requireUser<User>(client, { redirect, next: `/manage/${id}` });
  if (!hasRole(user, ["admin"])) {
    return <p className="notice">Only admins can manage products.</p>;
  }
  const product = await client.entity("products").get(id).catch(() => null);
  if (!product) notFound();
  return (
    <>
      <section className="card">
        <h1>Edit {product.name}</h1>
        <ProductForm product={product} />
      </section>
      <p>
        <Link href="/manage">Back to products</Link>
      </p>
    </>
  );
}
