import { createAstroClient, loadBrandingTheme } from "@bakorin/sdk/astro";
import { siteFileUrl } from "@bakorin/sdk/headless";
import type { BakorinEntities } from "./bakorin.gen.ts";

// Types and bakorinSchema come from app.yaml. After you change the schema, run:
//   bunx bakorin typegen -o web/src/lib/bakorin.gen.ts   (from the project folder)
export { bakorinSchema as schema } from "./bakorin.gen.ts";
export type User = BakorinEntities["users"];

// Read at runtime too, so one build works with any BAKORIN_URL.
const runtimeEnv = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

export function bakorinUrl(): string {
  return import.meta.env.BAKORIN_URL ?? runtimeEnv.BAKORIN_URL ?? "http://127.0.0.1:4371";
}

type AstroContext = { cookies: Parameters<typeof createAstroClient>[0]["cookies"]; clientAddress?: string };

/** The visitor IP, when the adapter provides it (prerendered pages do not). */
function visitorIp(context: AstroContext): string | undefined {
  try {
    return context.clientAddress;
  } catch {
    return undefined;
  }
}

// Pass Astro (in pages) or the middleware context. With BAKORIN_PROXY_SECRET set on
// both sides, Bakorin applies lockouts and rate limits per visitor.
export function api(context: AstroContext) {
  return createAstroClient<BakorinEntities>({
    baseUrl: bakorinUrl(),
    cookies: context.cookies,
    clientIp: visitorIp(context),
  });
}

// Brand colors from the branding section of app.yaml, for the components. Cached for 5 minutes.
let theme: { css: string; at: number } | null = null;
export async function brandingTheme(): Promise<string> {
  if (!theme || Date.now() - theme.at > 300_000) {
    theme = { css: await loadBrandingTheme(bakorinUrl()), at: Date.now() };
  }
  return theme.css;
}

/** A signed file link from the API, as a path on this site (through /api/bakorin). */
export function fileUrl(link: string | undefined | null): string | undefined {
  return siteFileUrl(link, { baseUrl: bakorinUrl() });
}

/** True when the user has one of the roles. */
export function hasRole(user: { role?: unknown } | null | undefined, roles: string[]): boolean {
  return Boolean(user && roles.includes(String(user.role)));
}

/** A record read with expand: the related rows and file details Bakorin attached. */
type Expanded = { $expand?: Record<string, Record<string, unknown> | undefined> };

/** The site path of an expanded file field (read the record with expand: "cover"). */
export function imageOf(row: object, field: string): string | undefined {
  const file = (row as Expanded).$expand?.[field];
  return typeof file?.url === "string" ? fileUrl(file.url) : undefined;
}

/** A related record pulled in with expand, for example the category of a post. */
export function relatedOf<T = Record<string, unknown>>(row: object, field: string): T | undefined {
  return (row as Expanded).$expand?.[field] as T | undefined;
}

