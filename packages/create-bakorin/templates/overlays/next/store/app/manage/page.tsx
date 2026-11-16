import { redirect } from "next/navigation";
import { requireUser } from "@bakorin/sdk/next";
import { api, hasRole, type User } from "../../lib/bakorin.ts";
import { ProductsCrud } from "./products-crud.tsx";

export const metadata = { title: "Manage products" };

export default async function ManagePage() {
  const client = await api();
  const user = await requireUser<User>(client, { redirect, next: "/manage" });
  if (!hasRole(user, ["admin"])) {
    return <p className="notice">Only admins can manage products.</p>;
  }
  const initial = await client.entity("products").list({ sort: "name", limit: 20 });
  return <ProductsCrud initial={initial} />;
}
