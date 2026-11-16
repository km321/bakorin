import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@bakorin/sdk/next";
import { api, hasRole, type User } from "../../../../lib/bakorin.ts";
import { MANAGERS } from "../../../../lib/team.ts";
import { ProjectForm } from "./project-form.tsx";

export const metadata = { title: "Project" };

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const client = await api();
  const { id } = await params;
  const user = await requireUser<User>(client, { redirect, next: `/app/projects/${id}` });
  const project = await client.entity("projects").get(id).catch(() => null);
  if (!project) notFound();
  // The API decides; this only explains up front when the form will not save.
  const canEdit = project.ownerId === user.id || hasRole(user, MANAGERS);
  return (
    <>
      <section className="card">
        <h1>{project.name}</h1>
        {!canEdit && <p className="notice">Only the project&apos;s owner, a manager, or an admin can save changes here.</p>}
        <ProjectForm project={project} />
      </section>
      <p>
        <Link href="/app/projects">Back to projects</Link>
      </p>
    </>
  );
}
