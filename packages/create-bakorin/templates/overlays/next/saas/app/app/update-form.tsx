"use client";

import { RecordForm } from "@bakorin/sdk/react";

/** Posts an update. The live list on the dashboard picks it up through realtime. */
export function UpdateForm() {
  return (
    <RecordForm
      entity="updates"
      include={["message", "projectId"]}
      labels={{ message: "Update", projectId: "Project (optional)" }}
      submitLabel="Post update"
      successMessage={null}
    />
  );
}
