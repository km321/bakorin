import Link from "next/link";
import { api, imageOf, relatedOf } from "../lib/bakorin.ts";
import { readableDate, type Category, type Post } from "../lib/blog.ts";

export const metadata = { title: "Posts" };
export const dynamic = "force-dynamic";

export default async function PostsPage() {
  // Posts and categories are public in app.yaml, so this works signed out too.
  const client = await api();
  const [{ data: posts }, { data: categories }] = await Promise.all([
    client.entity("posts").list({ sort: "-publishedOn", limit: 24, expand: "cover,categoryId" }),
    client.entity("categories").list({ sort: "name", limit: 50 }),
  ]);
  return (
    <>
      <section className="section">
        <h1>Posts</h1>
        {categories.length > 0 && (
          <nav aria-label="Categories" className="actions">
            {categories.map((category) => (
              <Link key={category.id} href={`/categories/${category.slug}`}>
                {category.name}
              </Link>
            ))}
          </nav>
        )}
      </section>
      <section className="section">
        {posts.length === 0 ? (
          <p className="empty">No posts yet. Admins can write one on the Write page, or run bun seed.ts for example posts.</p>
        ) : (
          <ul className="grid">
            {posts.map((post: Post) => {
              const cover = imageOf(post, "cover");
              const category = relatedOf<Category>(post, "categoryId");
              return (
                <li key={post.id} className="tile">
                  {cover ? <img className="media" src={cover} alt={post.coverAlt ?? ""} loading="lazy" /> : null}
                  <div className="tile-body">
                    <h2>
                      <Link href={`/posts/${post.slug}`}>{post.title}</Link>
                    </h2>
                    <p className="meta">
                      <time dateTime={post.publishedOn}>{readableDate(post.publishedOn)}</time>
                      {category ? ` · ${category.name}` : null}
                    </p>
                    {post.excerpt ? <p>{post.excerpt}</p> : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}
