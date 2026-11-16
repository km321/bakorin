import { redirect } from "next/navigation";
import { DataTable } from "@bakorin/sdk/react";
import { requireUser } from "@bakorin/sdk/next";
import { api, hasRole, type User } from "../../../lib/bakorin.ts";

export const metadata = { title: "Team" };

export default async function TeamPage() {
  const client = await api();
  const user = await requireUser<User>(client, { redirect, next: "/app/team" });
  if (!hasRole(user, ["admin"])) {
    return <p className="notice">Only admins can see the team list.</p>;
  }
  const initial = await client.entity("users").list({ sort: "name", limit: 25 });
  return (
    <section className="card">
      <h1>Team</h1>
      <p className="lede">Everyone with an account. Change roles (member, manager, admin) or invite people in the Bakorin admin at /admin on the API.</p>
      <DataTable entity="users" columns={["name", "email", "role", "createdAt"]} sort="name" limit={25} initial={initial} caption="Team members" hideCaption />
    </section>
  );
}
