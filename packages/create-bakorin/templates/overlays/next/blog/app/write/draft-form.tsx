"use client";

import { useRouter } from "next/navigation";
import { RecordForm } from "@bakorin/sdk/react";
import { DRAFT_FIELDS, type Draft } from "../../lib/blog.ts";

/** Creates a draft, or edits one when record is set. Saves through /api/bakorin. */
export function DraftForm({ record }: { record?: Draft }) {
  const router = useRouter();
  return (
    <RecordForm
      entity="drafts"
      record={record}
      include={DRAFT_FIELDS}
      isAdmin
      multiline={["body"]}
      accept={{ cover: "image/*" }}
      labels={{ coverAlt: "Cover description", categoryId: "Category" }}
      submitLabel="Save draft"
      onSuccess={() => router.refresh()}
    />
  );
}
