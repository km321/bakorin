/**
 * Rich text helpers: the allowlist HTML sanitizer the Bakorin server runs on every
 * richtext field before it is stored, and the same function for rendering, so a
 * page never trusts HTML it did not clean itself.
 *
 * Anything not on the allowlist is removed. Tags like script, style, and iframe
 * are removed with their content; other unknown tags are removed but their text
 * is kept. Every attribute is dropped unless it is listed below, and link and
 * image addresses must be relative or use an allowed scheme.
 */
import { Parser } from "htmlparser2";

/** Tags kept by sanitizeRichText. */
export const RICHTEXT_TAGS: readonly string[] = [
  "p",
  "br",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "s",
  "del",
  "sub",
  "sup",
  "a",
  "ul",
  "ol",
  "li",
  "blockquote",
  "code",
  "pre",
  "hr",
  "img",
];

const TAGS = new Set(RICHTEXT_TAGS);
const VOID = new Set(["br", "hr", "img"]);
/** Removed together with everything inside them. */
const DROP_WITH_CONTENT = new Set([
  "script",
  "style",
  "iframe",
  "frame",
  "frameset",
  "object",
  "embed",
  "applet",
  "noscript",
  "noembed",
  "noframes",
  "template",
  "textarea",
  "select",
  "option",
  "title",
  "head",
  "svg",
  "math",
  "xmp",
  "plaintext",
]);
const LINK_SCHEMES = new Set(["http", "https", "mailto", "tel"]);
const IMAGE_SCHEMES = new Set(["http", "https"]);
const REL_TOKENS = new Set(["nofollow", "noopener", "noreferrer", "ugc", "sponsored"]);

function escapeText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(value: string): string {
  return escapeText(value).replace(/"/g, "&quot;");
}

/**
 * A safe address, or null. Relative addresses are fine; absolute ones must use one
 * of the allowed schemes. Control characters and whitespace are removed first, the
 * same way browsers ignore them when they read a scheme.
 */
export function safeUrl(raw: string, schemes: ReadonlySet<string> = LINK_SCHEMES): string | null {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping them is the point
  const cleaned = raw.replace(/[\u0000-\u0020\u007f-\u009f]/g, "");
  if (cleaned === "" || cleaned.length > 2048) {
    return null;
  }
  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(cleaned);
  if (scheme) {
    return schemes.has(scheme[1]!.toLowerCase()) ? raw.trim() : null;
  }
  // No scheme: a path, a query, a fragment, or a protocol relative address.
  // A colon before the first slash would make some browsers read a scheme.
  const firstSlash = cleaned.search(/[/?#]/);
  const colon = cleaned.indexOf(":");
  if (colon !== -1 && (firstSlash === -1 || colon < firstSlash)) {
    return null;
  }
  return raw.trim();
}

function attributesFor(tag: string, attribs: Record<string, string>): string {
  const out: string[] = [];
  const add = (name: string, value: string) => out.push(` ${name}="${escapeAttr(value)}"`);
  if (tag === "a") {
    const href = attribs.href === undefined ? null : safeUrl(attribs.href, LINK_SCHEMES);
    if (href) add("href", href);
    if (attribs.title) add("title", attribs.title.slice(0, 300));
    const rel = new Set((attribs.rel ?? "").toLowerCase().split(/\s+/).filter((token) => REL_TOKENS.has(token)));
    if ((attribs.target ?? "").toLowerCase() === "_blank") {
      add("target", "_blank");
      rel.add("noopener");
      rel.add("noreferrer");
    }
    if (rel.size > 0) add("rel", [...rel].join(" "));
  } else if (tag === "img") {
    const src = attribs.src === undefined ? null : safeUrl(attribs.src, IMAGE_SCHEMES);
    if (!src) return "\u0000";
    add("src", src);
    add("alt", (attribs.alt ?? "").slice(0, 300));
    if (attribs.title) add("title", attribs.title.slice(0, 300));
    for (const name of ["width", "height"]) {
      const value = attribs[name];
      if (value && /^\d{1,5}$/.test(value)) add(name, value);
    }
  } else if (tag === "ol") {
    if (attribs.start && /^-?\d{1,6}$/.test(attribs.start)) add("start", attribs.start);
  } else if (tag === "code" || tag === "pre") {
    const language = (attribs.class ?? "").split(/\s+/).find((name) => /^language-[a-z0-9+#-]{1,32}$/i.test(name));
    if (language) add("class", language);
  }
  return out.join("");
}

/**
 * Cleans untrusted HTML down to the rich text allowlist. Safe to call on output
 * that was already cleaned: the result does not change.
 */
export function sanitizeRichText(html: string): string {
  if (typeof html !== "string" || html === "") {
    return "";
  }
  let out = "";
  let dropDepth = 0;
  const open: string[] = [];
  const parser = new Parser(
    {
      onopentag(name, attribs) {
        if (dropDepth > 0) {
          if (DROP_WITH_CONTENT.has(name)) dropDepth += 1;
          return;
        }
        if (DROP_WITH_CONTENT.has(name)) {
          dropDepth = 1;
          return;
        }
        if (!TAGS.has(name)) {
          return;
        }
        const attrs = attributesFor(name, attribs);
        if (attrs === "\u0000") {
          // An image without a safe src is dropped.
          return;
        }
        out += `<${name}${attrs}>`;
        if (!VOID.has(name)) {
          open.push(name);
        }
      },
      ontext(text) {
        if (dropDepth === 0) {
          out += escapeText(text);
        }
      },
      onclosetag(name) {
        if (dropDepth > 0) {
          if (DROP_WITH_CONTENT.has(name)) dropDepth -= 1;
          return;
        }
        if (VOID.has(name) || !TAGS.has(name)) {
          return;
        }
        const index = open.lastIndexOf(name);
        if (index === -1) {
          return;
        }
        while (open.length > index) {
          out += `</${open.pop()}>`;
        }
      },
    },
    { decodeEntities: true, lowerCaseTags: true, lowerCaseAttributeNames: true, recognizeSelfClosing: true },
  );
  parser.write(html);
  parser.end();
  while (open.length > 0) {
    out += `</${open.pop()}>`;
  }
  return out;
}

/** The text of a rich text value with the markup removed, for table cells, excerpts, and search results. */
export function richTextToPlain(html: string, maxLength?: number): string {
  if (typeof html !== "string" || html === "") {
    return "";
  }
  let text = "";
  let dropDepth = 0;
  const parser = new Parser(
    {
      onopentag(name) {
        if (DROP_WITH_CONTENT.has(name)) dropDepth += 1;
        else if (name === "br" || name === "p" || name === "li" || /^h[1-6]$/.test(name) || name === "blockquote") text += " ";
      },
      ontext(chunk) {
        if (dropDepth === 0) text += chunk;
      },
      onclosetag(name) {
        if (DROP_WITH_CONTENT.has(name)) dropDepth = Math.max(0, dropDepth - 1);
      },
    },
    { decodeEntities: true, lowerCaseTags: true },
  );
  parser.write(html);
  parser.end();
  const clean = text.replace(/\s+/g, " ").trim();
  if (maxLength !== undefined && clean.length > maxLength) {
    return `${clean.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
  }
  return clean;
}

/** True when the HTML has no text and no image, like the empty paragraph an editor leaves behind. */
export function isRichTextEmpty(html: string | null | undefined): boolean {
  if (!html) return true;
  return richTextToPlain(html) === "" && !/<img\b/i.test(html);
}
