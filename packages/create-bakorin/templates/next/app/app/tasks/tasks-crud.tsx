"use client";

import type { ListResult } from "@bakorin/sdk";
import { DataTable, RecordForm, useCollection } from "@bakorin/sdk/react";
import type { Tasks as Task } from "../../../lib/bakorin.gen.ts";

/** One live collection shared by the form and the table, so new rows show at once. */
export function TasksCrud({ initial }: { initial: ListResult<Task> }) {
  const tasks = useCollection<Task>("tasks", { sort: "-createdAt", limit: 10, initial, live: true });
  return (
    <>
      <RecordForm entity="tasks" include={["title"]} labels={{ title: "New task" }} submitLabel="Add task" collection={tasks} successMessage={null} />
      <DataTable<Task>
        entity="tasks"
        collection={tasks}
        columns={["title", "done", "createdAt"]}
        toggle={["done"]}
        deletable
        caption="Tasks"
        hideCaption
      />
    </>
  );
}
