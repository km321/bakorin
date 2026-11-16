import { redirect } from "next/navigation";
import { DataTable } from "@bakorin/sdk/react";
import { requireUser } from "@bakorin/sdk/next";
import { api, hasRole, type User } from "../../../lib/bakorin.ts";

export const metadata = { title: "Leads" };

export default async function LeadsPage() {
  const client = await api();
  // middleware.ts checks the session; leads are admin only in app.yaml.
  const user = await requireUser<User>(client, { redirect, next: "/app/leads" });
  if (!hasRole(user, ["admin"])) {
    return <p className="notice">Only admins can see leads.</p>;
  }
  const initial = await client.entity("leads").list({ sort: "-createdAt", limit: 20 });
  return (
    <section className="card">
      <h1>Leads</h1>
      <p className="lede">Messages from the contact form, newest first. Change a lead&apos;s status in the Bakorin admin.</p>
      <DataTable
        entity="leads"
        columns={["name", "email", "company", "message", "status", "createdAt"]}
        deletable
        sort="-createdAt"
        limit={20}
        initial={initial}
        caption="Leads"
        hideCaption
        emptyText="No messages yet."
      />
    </section>
  );
}
