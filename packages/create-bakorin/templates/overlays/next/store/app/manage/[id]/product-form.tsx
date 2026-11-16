"use client";

import { useRouter } from "next/navigation";
import { RecordForm } from "@bakorin/sdk/react";
import { PRODUCT_FIELDS, type Product } from "../../../lib/store.ts";

export function ProductForm({ product }: { product: Product }) {
  const router = useRouter();
  return (
    <RecordForm
      entity="products"
      record={product}
      include={PRODUCT_FIELDS}
      isAdmin
      multiline={["description"]}
      accept={{ image: "image/*" }}
      labels={{ priceCents: "Price in cents", imageAlt: "Photo description" }}
      onSuccess={() => router.push("/manage")}
    />
  );
}
