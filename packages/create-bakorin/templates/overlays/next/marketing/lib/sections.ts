import type { Sections } from "./bakorin.gen.ts";

export type Section = Sections;

/** Splits text into paragraphs on blank lines. */
export function paragraphs(body: string): string[] {
  return body
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean);
}
