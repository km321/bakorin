import { createAstroClient, loadBrandingTheme } from "@bakorin/sdk/astro";
import type { BakorinEntities } from "./bakorin.gen.ts";

// Types and bakorinSchema come from app.yaml. After you change the schema, run:
//   bunx bakorin typegen -o web/src/lib/bakorin.gen.ts   (from the project folder)
export { bakorinSchema as schema } from "./bakorin.gen.ts";
export type Task = BakorinEntities["tasks"];
export type User = BakorinEntities["users"];

export function bakorinUrl(): string {
  return import.meta.env.BAKORIN_URL ?? process.env.BAKORIN_URL ?? "http://127.0.0.1:4371";
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
