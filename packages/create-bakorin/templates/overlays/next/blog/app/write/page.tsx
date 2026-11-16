import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@bakorin/sdk/next";
import { api, hasRole, type User } from "../../lib/bakorin.ts";
import { readableDate } from "../../lib/blog.ts";
import { DraftForm } from "./draft-form.tsx";

export const metadata = { title: "Write" };

export default async function WritePage() {
  const client = await api();
  // middleware.ts makes sure someone is signed in. Writing is for admins; app.yaml
  // enforces the same rule on the API, this just shows a clear page.
  const user = await requireUser<User>(client, { redirect, next: "/write" });
  if (!hasRole(user, ["admin"])) {
    return <p className="notice">Only admins can write posts.</p>;
  }
  const [{ data: drafts }, { data: posts }] = await Promise.all([
    client.entity("drafts").list({ sort: "-updatedAt", limit: 50 }),
    client.entity("posts").list({ sort: "-publishedOn", limit: 20 }),
  ]);
  return (
    <>
      <section className="card">
        <h1>New draft</h1>
        <p className="lede">Drafts are private to admins. Open a draft to edit it and publish it.</p>
        <DraftForm />
      </section>
      <section className="card">
        <h2>Drafts</h2>
        {drafts.length === 0 ? (
          <p className="empty">No drafts.</p>
        ) : (
          <ul className="list">
            {drafts.map((draft) => (
              <li key={draft.id}>
                <Link href={`/write/${draft.id}`}>{draft.title}</Link>
                <span className="meta">Edited {new Date(draft.updatedAt).toLocaleDateString("en-US")}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="card">
        <h2>Published</h2>
        <p className="lede">Edit published posts in the Bakorin admin at /admin on the API.</p>
        {posts.length === 0 ? (
          <p className="empty">Nothing published yet.</p>
        ) : (
          <ul className="list">
            {posts.map((post) => (
              <li key={post.id}>
                <Link href={`/posts/${post.slug}`}>{post.title}</Link>
                <time className="meta" dateTime={post.publishedOn}>
                  {readableDate(post.publishedOn)}
                </time>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
