import Link from "next/link";
import { redirect } from "next/navigation";
import { Gate, LiveList } from "@bakorin/sdk/react";
import { requireUser } from "@bakorin/sdk/next";
import { api, type User } from "../../lib/bakorin.ts";
import { MANAGERS, STATUSES, type Update } from "../../lib/team.ts";
import { UpdateForm } from "./update-form.tsx";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const client = await api();
  // middleware.ts guards /app; requireUser also covers server rendering after a session ends.
  const user = await requireUser<User>(client, { redirect, next: "/app" });
  // One small request per status; the API answers with the total for each filter.
  const [counts, latest] = await Promise.all([
    Promise.all(STATUSES.map(async (status) => ({ status, total: (await client.entity("projects").list({ filter: { status }, limit: 1 })).meta.total }))),
    client.entity("updates").list({ sort: "-createdAt", limit: 8 }),
  ]);
  return (
    <>
      <section className="card">
        <h1>Hello, {user.name}</h1>
        <Gate roles={MANAGERS} fallback={<p className="lede">You can add projects and edit the ones you own. A manager or admin can change the rest.</p>}>
          <p className="banner">You are a {user.role}. You can edit and delete any project, and admins see the Team page.</p>
        </Gate>
        <dl className="facts">
          {counts.map((count) => (
            <div key={count.status} style={{ display: "contents" }}>
              <dt>{count.status[0]!.toUpperCase() + count.status.slice(1)}</dt>
              <dd>
                {count.total} {count.total === 1 ? "project" : "projects"}
              </dd>
            </div>
          ))}
        </dl>
        <Link href="/app/projects">See all projects</Link>
      </section>
      <div className="split section">
        <section className="card">
          <h2>Team updates</h2>
          <p className="lede">New updates show up here as your team posts them, in every open tab.</p>
          <LiveList<Update> entity="updates" sort="-createdAt" limit={8} live label="Team updates" emptyText="No updates yet." initial={latest} />
        </section>
        <section className="card">
          <h2>Post an update</h2>
          <UpdateForm />
        </section>
      </div>
    </>
  );
}
