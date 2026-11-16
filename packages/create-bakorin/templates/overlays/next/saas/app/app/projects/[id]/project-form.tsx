"use client";

import { useRouter } from "next/navigation";
import { RecordForm } from "@bakorin/sdk/react";
import { PROJECT_FIELDS, type Project } from "../../../../lib/team.ts";

export function ProjectForm({ project }: { project: Project }) {
  const router = useRouter();
  return (
    <RecordForm
      entity="projects"
      record={project}
      include={PROJECT_FIELDS}
      multiline={["notes"]}
      labels={{ dueOn: "Due date" }}
      onSuccess={() => router.push("/app/projects")}
    />
  );
}
