/** @jsxImportSource react */
import { createElement } from "react";
import { sanitizeRichText } from "../richtext.ts";

export interface RichTextProps {
  /** The value of a richtext field. */
  html: string | null | undefined;
  /** The wrapper element. Default div. */
  as?: "div" | "section" | "article" | "span";
  className?: string;
}

/**
 * Renders a richtext field. The HTML is cleaned again with the same allowlist the
 * server uses, so a value that reached the page some other way is still safe.
 * Works in Server Components and Client Components.
 */
export function RichText({ html, as = "div", className }: RichTextProps) {
  return createElement(as, {
    className: className ? `bk-richtext ${className}` : "bk-richtext",
    dangerouslySetInnerHTML: { __html: sanitizeRichText(html ?? "") },
  });
}
