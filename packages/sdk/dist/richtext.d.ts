/** Tags kept by sanitizeRichText. */
export declare const RICHTEXT_TAGS: readonly string[];
/**
 * A safe address, or null. Relative addresses are fine; absolute ones must use one
 * of the allowed schemes. Control characters and whitespace are removed first, the
 * same way browsers ignore them when they read a scheme.
 */
export declare function safeUrl(raw: string, schemes?: ReadonlySet<string>): string | null;
/**
 * Cleans untrusted HTML down to the rich text allowlist. Safe to call on output
 * that was already cleaned: the result does not change.
 */
export declare function sanitizeRichText(html: string): string;
/** The text of a rich text value with the markup removed, for table cells, excerpts, and search results. */
export declare function richTextToPlain(html: string, maxLength?: number): string;
/** True when the HTML has no text and no image, like the empty paragraph an editor leaves behind. */
export declare function isRichTextEmpty(html: string | null | undefined): boolean;
