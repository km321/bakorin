import { redirect } from "next/navigation";
import { Gate } from "@bakorin/sdk/react";
import { requireUser } from "@bakorin/sdk/next";
import { api, type User } from "../../lib/bakorin.ts";

export const metadata = { title: "Account" };

export default async function AccountPage() {
  // middleware.ts guards /app; requireUser also covers server rendering after a session ends.
  const user = await requireUser<User>(await api(), { redirect, next: "/app" });
  return (
    <section className="card">
      <h1>Hello, {user.name}</h1>
      <p className="lede">This page is protected by authMiddleware in middleware.ts.</p>
      <dl className="facts">
        <dt>Email</dt>
        <dd>{user.email}</dd>
        <dt>Role</dt>
        <dd>{user.role}</dd>
      </dl>
      <Gate roles={["admin"]}>
        <p className="banner">You are an admin. Open the Bakorin admin at /admin on the API.</p>
      </Gate>
    </section>
  );
}
