import { redirect } from "next/navigation";
import { requireUser } from "@bakorin/sdk/next";
import { api, hasRole, type User } from "../../../lib/bakorin.ts";
import { MANAGERS } from "../../../lib/team.ts";
import { ProjectsCrud } from "./projects-crud.tsx";

export const metadata = { title: "Projects" };

export default async function ProjectsPage() {
  const client = await api();
  const user = await requireUser<User>(client, { redirect, next: "/app/projects" });
  const initial = await client.entity("projects").list({ sort: "-updatedAt", limit: 15 });
  // app.yaml lets managers and admins delete projects; everyone else does not get the button.
  return <ProjectsCrud initial={initial} canDelete={hasRole(user, MANAGERS)} />;
}
