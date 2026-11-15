/**
 * A small, logic-light template engine for transactional email.
 *
 * Syntax (handlebars-like):
 *   {{ path.to.value }}        HTML escaped output (always, in .html files)
 *   {{#if path}} ... {{else}} ... {{/if}}
 *   {{#unless path}} ... {{/unless}}
 *   {{#each path}} {{ this.name }} {{ @index }} {{/each}}
 *   {{{ body }}}               raw output, only allowed for "body" inside _layout.html
 *
 * Lookups only read own properties, so prototype keys like __proto__ or
 * constructor resolve to nothing. Missing values render as an empty string.
 */

export type TemplateMode = "html" | "text";

export class TemplateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TemplateError";
  }
}

type Node =
  | { kind: "text"; value: string }
  | { kind: "var"; path: string; raw: boolean }
  | { kind: "if"; path: string; negate: boolean; then: Node[]; otherwise: Node[] }
  | { kind: "each"; path: string; body: Node[]; otherwise: Node[] };

const TOKEN = /\{\{(\{?)\s*([^}]*?)\s*(\}?)\}\}/g;
const PATH = /^(@index|@first|@last|this(\.[A-Za-z0-9_-]+)*|[A-Za-z_][A-Za-z0-9_-]*(\.[A-Za-z0-9_-]+)*)$/;

export interface CompileOptions {
  /** Names allowed for {{{ raw }}} output. Empty by default. */
  allowRaw?: string[];
  name?: string;
}

export interface CompiledTemplate {
  render(data: unknown, mode: TemplateMode): string;
}

const cache = new Map<string, Node[]>();

export function compileTemplate(source: string, options: CompileOptions = {}): CompiledTemplate {
  const key = `${(options.allowRaw ?? []).join(",")}\u0000${source}`;
  let nodes = cache.get(key);
  if (!nodes) {
    nodes = parse(source, options);
    if (cache.size > 500) {
      cache.clear();
    }
    cache.set(key, nodes);
  }
  const tree = nodes;
  return {
    render(data, mode) {
      return renderNodes(tree, [data], mode, {});
    },
  };
}

export function renderTemplate(source: string, data: unknown, mode: TemplateMode, options: CompileOptions = {}): string {
  return compileTemplate(source, options).render(data, mode);
}

function parse(source: string, options: CompileOptions): Node[] {
  const label = options.name ? `${options.name}: ` : "";
  const allowRaw = new Set(options.allowRaw ?? []);
  const root: Node[] = [];
  const stack: Array<{ node: Extract<Node, { kind: "if" | "each" }>; inElse: boolean; open: string }> = [];
  const current = (): Node[] => {
    const top = stack.at(-1);
    if (!top) {
      return root;
    }
    if (top.node.kind === "if") {
      return top.inElse ? top.node.otherwise : top.node.then;
    }
    return top.inElse ? top.node.otherwise : top.node.body;
  };
  let last = 0;
  for (const match of source.matchAll(TOKEN)) {
    const index = match.index ?? 0;
    if (index > last) {
      current().push({ kind: "text", value: source.slice(last, index) });
    }
    last = index + match[0].length;
    const triple = match[1] === "{";
    if (triple !== (match[3] === "}")) {
      throw new TemplateError(`${label}unbalanced braces in ${match[0]}`);
    }
    const inner = (match[2] ?? "").trim();
    if (inner.startsWith("!")) {
      continue;
    }
    if (triple) {
      if (!allowRaw.has(inner)) {
        throw new TemplateError(
          `${label}raw output {{{ ${inner} }}} is not allowed; use {{ ${inner} }} so values are escaped`,
        );
      }
      current().push({ kind: "var", path: inner, raw: true });
      continue;
    }
    if (inner.startsWith("#")) {
      const [keyword, path = "", ...rest] = inner.slice(1).trim().split(/\s+/);
      if (rest.length > 0 || !PATH.test(path)) {
        throw new TemplateError(`${label}invalid block {{${inner}}}`);
      }
      let node: Extract<Node, { kind: "if" | "each" }>;
      if (keyword === "if" || keyword === "unless") {
        node = { kind: "if", path, negate: keyword === "unless", then: [], otherwise: [] };
      } else if (keyword === "each") {
        node = { kind: "each", path, body: [], otherwise: [] };
      } else {
        throw new TemplateError(`${label}unknown block {{#${keyword}}}; use if, unless, or each`);
      }
      current().push(node);
      stack.push({ node, inElse: false, open: keyword ?? "" });
      continue;
    }
    if (inner === "else") {
      const top = stack.at(-1);
      if (!top || top.inElse) {
        throw new TemplateError(`${label}{{else}} without a matching {{#if}} or {{#each}}`);
      }
      top.inElse = true;
      continue;
    }
    if (inner.startsWith("/")) {
      const keyword = inner.slice(1).trim();
      const top = stack.pop();
      if (!top || top.open !== keyword) {
        throw new TemplateError(`${label}{{/${keyword}}} does not close an open block`);
      }
      continue;
    }
    if (!PATH.test(inner)) {
      throw new TemplateError(`${label}invalid expression {{ ${inner} }}; only dotted paths like record.email are supported`);
    }
    current().push({ kind: "var", path: inner, raw: false });
  }
  if (last < source.length) {
    current().push({ kind: "text", value: source.slice(last) });
  }
  const open = stack.at(-1);
  if (open) {
    throw new TemplateError(`${label}{{#${open.open}}} is never closed`);
  }
  return root;
}

interface Loop {
  index?: number;
  first?: boolean;
  last?: boolean;
}

function renderNodes(nodes: Node[], scopes: unknown[], mode: TemplateMode, loop: Loop): string {
  let out = "";
  for (const node of nodes) {
    if (node.kind === "text") {
      out += node.value;
    } else if (node.kind === "var") {
      const value = lookup(node.path, scopes, loop);
      const text = stringify(value);
      out += node.raw || mode === "text" ? text : escapeHtml(text);
    } else if (node.kind === "if") {
      const truthy = isTruthy(lookup(node.path, scopes, loop));
      out += renderNodes(truthy !== node.negate ? node.then : node.otherwise, scopes, mode, loop);
    } else {
      const value = lookup(node.path, scopes, loop);
      const items = Array.isArray(value) ? value : [];
      if (items.length === 0) {
        out += renderNodes(node.otherwise, scopes, mode, loop);
        continue;
      }
      items.forEach((item, index) => {
        out += renderNodes(node.body, [item, ...scopes], mode, {
          index,
          first: index === 0,
          last: index === items.length - 1,
        });
      });
    }
  }
  return out;
}

function lookup(path: string, scopes: unknown[], loop: Loop): unknown {
  if (path === "@index") {
    return loop.index;
  }
  if (path === "@first") {
    return loop.first;
  }
  if (path === "@last") {
    return loop.last;
  }
  const parts = path.split(".");
  let value: unknown;
  if (parts[0] === "this") {
    value = scopes[0];
    parts.shift();
  } else {
    const head = parts[0] ?? "";
    const scope = scopes.find((candidate) => isObject(candidate) && Object.hasOwn(candidate, head));
    value = scope ?? scopes.at(-1);
  }
  for (const part of parts) {
    if (!isObject(value) || !Object.hasOwn(value, part)) {
      return undefined;
    }
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isTruthy(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  return Boolean(value);
}

function stringify(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return JSON.stringify(value);
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
    .replaceAll("`", "&#96;")
    .replaceAll("=", "&#61;");
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  "#39": "'",
  "#96": "`",
  "#61": "=",
};

/** Turns rendered HTML into a readable plain text alternative. */
export function htmlToText(html: string): string {
  let text = html
    .replace(/<(head|style|script|title)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\s+/g, " ")
    .replace(/<a\s[^>]*href\s*=\s*"([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_match, href: string, label: string) => {
      const inner = label.replace(/<[^>]+>/g, "").trim();
      return inner && inner !== href ? `${inner} (${href})` : href;
    })
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<\/(p|div|h[1-6]|tr|table|ul|ol|blockquote|section|header|footer)>/gi, "\n\n")
    .replace(/<\/(td|th)>/gi, "  ")
    .replace(/<[^>]+>/g, "");
  text = text.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (match, name: string) => {
    const lower = name.toLowerCase();
    if (ENTITIES[lower] !== undefined) {
      return ENTITIES[lower] as string;
    }
    if (lower.startsWith("#x")) {
      return String.fromCodePoint(Number.parseInt(lower.slice(2), 16));
    }
    if (lower.startsWith("#")) {
      return String.fromCodePoint(Number.parseInt(lower.slice(1), 10));
    }
    return match;
  });
  return text
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
