import { createClient, type AuthTokens, type ClientOptions } from "./index.ts";
import { createProxyHandler, type ProxyOptions } from "./proxy.ts";
export { createProxyHandler, isSameSiteRequest, type ProxyOptions } from "./proxy.ts";

/**
 * Astro helper. Pass Astro.cookies from a page, endpoint, or middleware.
 */
export function createAstroClient<S extends Record<string, Record<string, unknown>>>(
  options: Omit<ClientOptions, "getAccessToken" | "getRefreshToken" | "setTokens"> & {
    cookies: {
      get: (name: string) => { value?: string } | undefined;
      set: (name: string, value: string, opts?: object) => void;
    };
  },
) {
  return createClient<S>({
    ...options,
    getAccessToken: () => options.cookies.get("bakorin_access")?.value ?? null,
    getRefreshToken: () => options.cookies.get("bakorin_refresh")?.value ?? null,
    setTokens: (tokens: AuthTokens) => {
      options.cookies.set("bakorin_access", tokens.accessToken, { httpOnly: true, sameSite: "lax", path: "/" });
      options.cookies.set("bakorin_refresh", tokens.refreshToken, { httpOnly: true, sameSite: "lax", path: "/" });
    },
  });
}

/**
 * A ready made pass through route for browser code. Create
 * src/pages/api/bakorin/[...path].ts with:
 *
 *   import { createAstroProxy } from "@bakorin/sdk/astro";
 *   export const prerender = false;
 *   export const ALL = createAstroProxy({ baseUrl: import.meta.env.BAKORIN_URL });
 *
 * Then use createBrowserClient() from "@bakorin/sdk/browser" in client scripts.
 */
export function createAstroProxy(options: ProxyOptions) {
  const handle = createProxyHandler(options);
  return ({ request }: { request: Request }) => handle(request);
}
