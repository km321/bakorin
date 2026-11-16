import Link from "next/link";
import { notFound } from "next/navigation";
import { api, imageOf, relatedOf } from "../../../lib/bakorin.ts";
import { paragraphs, readableDate, type Category } from "../../../lib/blog.ts";

async function findPost(slug: string) {
  const { data } = await (await api()).entity("posts").list({ filter: { slug }, limit: 1, expand: "cover,categoryId" });
  return data[0];
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const post = await findPost((await params).slug);
  return { title: post?.title ?? "Not found" };
}

export default async function PostPage({ params }: { params: Promise<{ slug: string }> }) {
  const post = await findPost((await params).slug);
  if (!post) notFound();
  const cover = imageOf(post, "cover");
  const category = relatedOf<Category>(post, "categoryId");
  return (
    <>
      <article className="card">
        <h1>{post.title}</h1>
        <p className="meta">
          <time dateTime={post.publishedOn}>{readableDate(post.publishedOn)}</time>
          {category ? (
            <>
              {" · "}
              <Link href={`/categories/${category.slug}`}>{category.name}</Link>
            </>
          ) : null}
        </p>
        {cover ? <img className="media" src={cover} alt={post.coverAlt ?? ""} /> : null}
        <div className="prose">
          {paragraphs(post.body).map((text, index) => (
            <p key={index}>{text}</p>
          ))}
        </div>
      </article>
      <p>
        <Link href="/">Back to all posts</Link>
      </p>
    </>
  );
}
