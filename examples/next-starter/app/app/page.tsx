import { redirect } from "next/navigation";
import { FileUpload, Gate, LiveList } from "@bakorin/sdk/react";
import { requireUser } from "@bakorin/sdk/next";
import { api, type User } from "../../lib/bakorin.ts";
import type { Tasks as Task } from "../../lib/bakorin.gen.ts";

export default async function DashboardPage() {
  const client = await api();
  // middleware.ts guards /app; requireUser also covers server rendering after a session ends.
  const user = await requireUser<User>(client, { redirect, next: "/app" });
  const latest = await client.entity("tasks").list({ sort: "-createdAt", limit: 5 });
  return (
    <>
      <section className="card">
        <h1>Hello, {user.name}</h1>
        <p className="lede">This page is protected by authMiddleware in middleware.ts.</p>
        <Gate roles={["admin"]} fallback={<p>Your role is {user.role}. Admin only content stays hidden.</p>}>
          <p className="banner">You are an admin. Open the Bakorin admin at /admin on the API.</p>
        </Gate>
      </section>
      <section className="card">
        <h2>Latest tasks</h2>
        <p className="lede">
          This list follows realtime changes. Add a task on the <a href="/app/tasks">tasks page</a> in another tab.
        </p>
        <LiveList<Task> entity="tasks" sort="-createdAt" limit={5} label="Latest tasks" initial={latest} />
      </section>
      <section className="card">
        <h2>Upload a file</h2>
        <p className="lede">Files go through /api/bakorin with your session cookie and come back as a signed link.</p>
        <FileUpload accept="image/*,application/pdf,text/plain" maxBytes={10485760} />
      </section>
    </>
  );
}
