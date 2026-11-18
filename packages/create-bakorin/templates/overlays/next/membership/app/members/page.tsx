import Link from "next/link";
import { RichText } from "@bakorin/sdk/react";
import { refreshUrl } from "@bakorin/sdk/next";
import { api, currentUser } from "../../lib/bakorin.ts";
import { isMember, isPro, type Lesson, type Masterclass } from "../../lib/membership.ts";

export const metadata = { title: "Members" };
export const dynamic = "force-dynamic";

export default async function MembersPage() {
  // app.yaml decides who reads what: lessons need role(basic) or role(pro), masterclasses role(pro).
  // The checks here only pick the message; the API refuses everyone else. A plan change shows
  // up in the session after it renews, so a refused list offers a refresh.
  const client = await api();
  const user = await currentUser();
  let stale = false;
  async function load<T>(entity: "lessons" | "masterclasses", allowed: boolean): Promise<T[]> {
    if (!allowed) return [];
    try {
      return (await client.entity(entity).list({ sort: "sort", limit: 50 })).data as T[];
    } catch {
      stale = true;
      return [];
    }
  }
  const lessons = await load<Lesson>("lessons", isMember(user?.role));
  const masterclasses = await load<Masterclass>("masterclasses", isPro(user?.role));
  return (
    <>
      {stale ? (
        <p className="notice" role="status">
          Your plan changed. <a href={refreshUrl("/members")}>Refresh your session</a> to see everything it includes.
        </p>
      ) : null}
      <section className="section" aria-labelledby="lessons-heading">
        <h1 id="lessons-heading">Lessons</h1>
        {!isMember(user?.role) ? (
          <p className="notice">
            Lessons are for members. <Link href="/">Pick a plan</Link> to read them.
          </p>
        ) : lessons.length === 0 ? (
          <p className="empty">No lessons yet.</p>
        ) : (
          lessons.map((lesson) => (
            <article key={lesson.id} className="card">
              <h2>{lesson.title}</h2>
              {lesson.summary ? <p className="meta">{lesson.summary}</p> : null}
              {lesson.body ? <RichText html={lesson.body} className="prose" /> : null}
            </article>
          ))
        )}
      </section>
      <section className="section" aria-labelledby="masterclasses-heading">
        <h2 id="masterclasses-heading">Masterclasses</h2>
        {!isPro(user?.role) ? (
          <p className="notice">
            Masterclasses are for Pro members. <Link href="/">See the Pro plan</Link>.
          </p>
        ) : masterclasses.length === 0 ? (
          <p className="empty">No masterclasses yet.</p>
        ) : (
          masterclasses.map((item) => (
            <article key={item.id} className="card">
              <h3>{item.title}</h3>
              {item.summary ? <p className="meta">{item.summary}</p> : null}
              {item.body ? <RichText html={item.body} className="prose" /> : null}
            </article>
          ))
        )}
      </section>
    </>
  );
}
