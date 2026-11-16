"use client";

import type { ListResult } from "@bakorin/sdk";
import { DataTable, RecordForm, useCollection } from "@bakorin/sdk/react";
import { PROJECT_FIELDS, type Project } from "../../../lib/team.ts";

/** One live collection shared by the form and the table, so new rows show at once. */
export function ProjectsCrud({ initial, canDelete }: { initial: ListResult<Project>; canDelete: boolean }) {
  const projects = useCollection<Project>("projects", { sort: "-updatedAt", limit: 15, initial, live: true });
  return (
    <div className="split">
      <section className="card">
        <h1>Projects</h1>
        <p className="lede">Everyone on the team sees every project. Changes show up live.</p>
        <DataTable<Project>
          entity="projects"
          collection={projects}
          columns={["name", "status", "dueOn", "updatedAt"]}
          rowLink={{ field: "name", href: "/app/projects/:id" }}
          deletable={canDelete}
          caption="Projects"
          hideCaption
          emptyText="No projects yet. Add the first one."
        />
      </section>
      <section className="card">
        <h2>New project</h2>
        <RecordForm
          entity="projects"
          include={PROJECT_FIELDS}
          multiline={["notes"]}
          labels={{ dueOn: "Due date" }}
          submitLabel="Add project"
          collection={projects}
          successMessage={null}
        />
      </section>
    </div>
  );
}
