"use server";

import { redirect } from "next/navigation";
import { api, currentUser, hasRole } from "../../lib/bakorin.ts";
import { today } from "../../lib/blog.ts";

/** Copies a draft into posts (public) with today's date, then removes the draft. */
export async function publishDraft(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  const client = await api();
  const user = await currentUser();
  if (!hasRole(user, ["admin"])) redirect("/login");
  const draft = await client.entity("drafts").get(id);
  try {
    await client.entity("posts").create({
      title: draft.title,
      slug: draft.slug,
      excerpt: draft.excerpt,
      body: draft.body,
      cover: draft.cover,
      coverAlt: draft.coverAlt,
      categoryId: draft.categoryId,
      publishedOn: today(),
      authorId: user!.id,
    });
  } catch (error) {
    // For example a post with this slug already exists. Show it on the draft page.
    const message = error instanceof Error ? error.message : "Could not publish the draft";
    redirect(`/write/${id}?error=${encodeURIComponent(message)}`);
  }
  await client.entity("drafts").delete(id);
  redirect(`/posts/${draft.slug}`);
}

export async function deleteDraft(formData: FormData): Promise<void> {
  await (await api()).entity("drafts").delete(String(formData.get("id") ?? ""));
  redirect("/write");
}
