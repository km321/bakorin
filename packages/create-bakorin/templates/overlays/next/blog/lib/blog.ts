import type { Categories, Drafts, Posts } from "./bakorin.gen.ts";

export type Post = Posts;
export type Category = Categories;
export type Draft = Drafts;

/** The fields a writer fills in for a draft, in form order. */
export const DRAFT_FIELDS = ["title", "slug", "excerpt", "body", "cover", "coverAlt", "categoryId"];

/** Splits a post body into paragraphs on blank lines. */
export function paragraphs(body: string): string[] {
  return body
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/** A date only value (2026-11-16) for people to read, without shifting the day by time zone. */
export function readableDate(value: string | undefined): string {
  if (!value) return "";
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 1, day!)).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
}

/** Today as YYYY-MM-DD. */
export function today(): string {
  return new Date().toISOString().slice(0, 10);
}
