"use client";

import type { ListResult } from "@bakorin/sdk";
import { DataTable, RecordForm, useCollection } from "@bakorin/sdk/react";
import { PRODUCT_FIELDS, type Product } from "../../lib/store.ts";

/** Admin product list and form, sharing one collection so new products show at once. */
export function ProductsCrud({ initial }: { initial: ListResult<Product> }) {
  const products = useCollection<Product>("products", { sort: "name", limit: 20, initial });
  return (
    <div className="split">
      <section className="card">
        <h1>Products</h1>
        <p className="lede">Untick Active to hide a product from the shop. Open a product to edit it.</p>
        <DataTable<Product>
          entity="products"
          collection={products}
          columns={["name", "priceCents", "active", "updatedAt"]}
          rowLink={{ field: "name", href: "/manage/:id" }}
          toggle={["active"]}
          deletable
          caption="Products"
          hideCaption
        />
      </section>
      <section className="card">
        <h2>New product</h2>
        <RecordForm
          entity="products"
          include={PRODUCT_FIELDS}
          isAdmin
          multiline={["description"]}
          accept={{ image: "image/*" }}
          labels={{ priceCents: "Price in cents", imageAlt: "Photo description" }}
          submitLabel="Add product"
          collection={products}
          successMessage={null}
        />
      </section>
    </div>
  );
}
