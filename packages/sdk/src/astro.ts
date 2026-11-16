import { createClient, envProxySecret, visitorHeaders, type AuthTokens, type ClientOptions } from "./index.ts";
import { createProxyHandler, rightmostForwardedFor, type ProxyOptions } from "./proxy.ts";
export { createProxyHandler, isSameSiteRequest, rightmostForwardedFor, type ProxyOptions } from "./proxy.ts";

/** The default pass through route. The refresh cookie lives on this path. */
export const DEFAULT_PROXY_PREFIX = "/api/bakorin";

/**
 * Astro helper. Pass Astro.cookies from a page, endpoint, or middleware.
 */
export function createAstroClient<S extends Record<string, Record<string, unknown>>>(
  options: Omit<ClientOptions, "getAccessToken" | "getRefreshToken" | "setTokens"> & {
    cookies: {
      get: (name: string) => { value?: string } | undefined;
      set: (name: string, value: string, opts?: object) => void;
    };
    /** The visitor IP (Astro.clientAddress). Sent to Bakorin with proxySecret so lockouts and rate limits are per visitor. */
    clientIp?: string | null;
    /** Shared with the Bakorin server as BAKORIN_PROXY_SECRET. Default: process.env.BAKORIN_PROXY_SECRET. */
    proxySecret?: string;
    /** Path of the refresh cookie. Default /api/bakorin, the pass through route, so pages never see it. */
    refreshPath?: string;
  },
) {
  const { clientIp, proxySecret, refreshPath = DEFAULT_PROXY_PREFIX, ...rest } = options;
  return createClient<S>({
    ...rest,
    headers: { ...rest.headers, ...visitorHeaders(clientIp, proxySecret ?? envProxySecret()) },
    getAccessToken: () => options.cookies.get("bakorin_access")?.value ?? null,
    getRefreshToken: () => options.cookies.get("bakorin_refresh")?.value ?? null,
    setTokens: (tokens: AuthTokens) => {
      options.cookies.set("bakorin_access", tokens.accessToken, { httpOnly: true, sameSite: "lax", path: "/", maxAge: tokens.expiresIn });
      options.cookies.set("bakorin_refresh", tokens.refreshToken, { httpOnly: true, sameSite: "lax", path: refreshPath, maxAge: 30 * 24 * 3600 });
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
  // Astro's clientAddress is the socket peer (or what your adapter trusts), so it is safe by default.
  const addresses = new WeakMap<Request, string>();
  const handle = createProxyHandler({ getClientIp: (request) => addresses.get(request), ...options });
  return (context: { request: Request; clientAddress?: string }) => {
    try {
      if (context.clientAddress) addresses.set(context.request, context.clientAddress);
    } catch {
      // the adapter does not provide clientAddress
    }
    return handle(context.request);
  };
}
