import { createNextClient, loadBrandingTheme, rightmostForwardedFor } from "@bakorin/sdk/next";
import { siteFileUrl } from "@bakorin/sdk/headless";
import { cookies, headers } from "next/headers";
import type { BakorinEntities } from "./bakorin.gen.ts";

// Types and bakorinSchema come from app.yaml. After you change the schema, run:
//   bunx bakorin typegen -o web/lib/bakorin.gen.ts   (from the project folder)
export { bakorinSchema as schema } from "./bakorin.gen.ts";
export type User = BakorinEntities["users"];

export function bakorinUrl(): string {
  return process.env.BAKORIN_URL ?? "http://127.0.0.1:4371";
}

// With BAKORIN_PROXY_SECRET set on both sides, Bakorin applies lockouts and rate
// limits per visitor. The visitor IP is the right end of X-Forwarded-For, which is
// right behind one platform or proxy (Vercel, Railway, Netlify, Fly, nginx).
export async function api() {
  return createNextClient<BakorinEntities>({
    baseUrl: bakorinUrl(),
    cookies: await cookies(),
    clientIp: rightmostForwardedFor(await headers()),
  });
}

/** The signed in user, or null. Server components only. */
export async function currentUser(): Promise<User | null> {
  if (!(await cookies()).get("bakorin_access")) {
    return null;
  }
  return ((await (await api()).me().catch(() => null)) as User | null) ?? null;
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

