import Link from "next/link";
import { notFound } from "next/navigation";
import { api } from "../../../lib/bakorin.ts";
import { readableDate } from "../../../lib/blog.ts";

async function findCategory(slug: string) {
  const { data } = await (await api()).entity("categories").list({ filter: { slug }, limit: 1 });
  return data[0];
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  return { title: (await findCategory((await params).slug))?.name ?? "Not found" };
}

export default async function CategoryPage({ params }: { params: Promise<{ slug: string }> }) {
  const client = await api();
  const category = await findCategory((await params).slug);
  if (!category) notFound();
  const { data: posts } = await client.entity("posts").list({ filter: { categoryId: category.id }, sort: "-publishedOn", limit: 50 });
  return (
    <>
      <section className="card">
        <h1>{category.name}</h1>
        {posts.length === 0 ? (
          <p className="empty">No posts in this category yet.</p>
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
      <p>
        <Link href="/">Back to all posts</Link>
      </p>
    </>
  );
}
