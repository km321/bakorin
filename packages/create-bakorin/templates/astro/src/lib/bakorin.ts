import { createAstroClient } from "@bakorin/sdk/astro";

export type Task = {
  id: string;
  title: string;
  done: boolean;
  ownerId: string;
};

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
  return createAstroClient<{ users: Record<string, unknown>; tasks: Task }>({
    baseUrl: bakorinUrl(),
    cookies: context.cookies,
    clientIp: visitorIp(context),
  });
}
