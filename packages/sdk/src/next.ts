import { createClient, envProxySecret, visitorHeaders, type AuthTokens, type ClientOptions } from "./index.ts";
import { createProxyHandler, rightmostForwardedFor, type ProxyOptions } from "./proxy.ts";
export { createProxyHandler, isSameSiteRequest, rightmostForwardedFor, type ProxyOptions } from "./proxy.ts";

/** The default pass through route. The refresh cookie lives on this path. */
export const DEFAULT_PROXY_PREFIX = "/api/bakorin";

/**
 * Next.js helper. Pass cookie read/write from Route Handlers or Server Actions.
 * This package does not depend on next.
 */
export function createNextClient<S extends Record<string, Record<string, unknown>>>(
  options: Omit<ClientOptions, "getAccessToken" | "getRefreshToken" | "setTokens"> & {
    cookies: {
      get: (name: string) => { value?: string } | undefined;
      set?: (name: string, value: string, opts?: object) => void;
    };
    /** The visitor IP. Sent to Bakorin with proxySecret so lockouts and rate limits are per visitor. */
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
      options.cookies.set?.("bakorin_access", tokens.accessToken, { httpOnly: true, sameSite: "lax", path: "/", maxAge: tokens.expiresIn });
      options.cookies.set?.("bakorin_refresh", tokens.refreshToken, { httpOnly: true, sameSite: "lax", path: refreshPath, maxAge: 30 * 24 * 3600 });
    },
  });
}

/**
 * A ready made pass through route for client components. Create
 * app/api/bakorin/[...path]/route.ts with:
 *
 *   import { createNextProxy } from "@bakorin/sdk/next";
 *   export const dynamic = "force-dynamic";
 *   export const { GET, POST, PATCH, PUT, DELETE } = createNextProxy({ baseUrl: process.env.BAKORIN_URL! });
 */
export function createNextProxy(options: ProxyOptions) {
  // Next route handlers have no socket address. Behind one platform or proxy
  // (Vercel, Railway, Netlify, Fly, nginx) the right end of X-Forwarded-For is the visitor.
  const handle = createProxyHandler({ getClientIp: rightmostForwardedFor, ...options });
  const route = (request: Request) => handle(request);
  return { GET: route, POST: route, PATCH: route, PUT: route, DELETE: route, HEAD: route };
}
