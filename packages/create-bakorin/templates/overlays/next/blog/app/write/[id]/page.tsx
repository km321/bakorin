import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@bakorin/sdk/next";
import { api, hasRole, type User } from "../../../lib/bakorin.ts";
import { DraftForm } from "../draft-form.tsx";
import { deleteDraft, publishDraft } from "../actions.ts";

export const metadata = { title: "Edit draft" };

export default async function EditDraftPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const client = await api();
  const { id } = await params;
  const user = await requireUser<User>(client, { redirect, next: `/write/${id}` });
  if (!hasRole(user, ["admin"])) {
    return <p className="notice">Only admins can write posts.</p>;
  }
  const draft = await client.entity("drafts").get(id).catch(() => null);
  if (!draft) notFound();
  const { error } = await searchParams;
  return (
    <>
      <section className="card">
        <h1>Edit draft</h1>
        <DraftForm record={draft} />
      </section>
      <section className="card">
        <h2>Publish</h2>
        <p className="lede">Publishing makes the post public at /posts/{draft.slug} and removes this draft. Save your changes first.</p>
        {error ? (
          <div className="error" role="alert">
            {error}
          </div>
        ) : null}
        <div className="actions">
          <form action={publishDraft} className="inline-form">
            <input type="hidden" name="id" value={draft.id} />
            <button type="submit">Publish</button>
          </form>
          <form action={deleteDraft} className="inline-form">
            <input type="hidden" name="id" value={draft.id} />
            <button type="submit" className="secondary">
              Delete draft
            </button>
          </form>
        </div>
      </section>
      <p>
        <Link href="/write">Back to drafts</Link>
      </p>
    </>
  );
}
