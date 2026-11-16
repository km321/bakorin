import { createClient, envProxySecret, visitorHeaders, type AuthTokens, type ClientOptions } from "./index.ts";
import { createProxyHandler, rightmostForwardedFor, type ProxyOptions } from "./proxy.ts";
export { createProxyHandler, isSameSiteRequest, rightmostForwardedFor, type ProxyOptions } from "./proxy.ts";
import { forbidden, hasRole, isProtected, refreshUrl, type GuardOptions } from "./guard.ts";
export { isProtected, refreshUrl, type GuardOptions, type ProtectRule } from "./guard.ts";
export { loadBrandingTheme } from "./headless/theme.ts";

/** The default pass through route. The refresh cookie lives on this path. */
export const DEFAULT_PROXY_PREFIX = "/api/bakorin";

/**
 * Next.js helper. Pass cookie read/write from Route Handlers or Server Actions.
 * This package does not depend on next.
 */
export function createNextClient<S extends object = Record<string, Record<string, unknown>>>(
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

function cookieValue(header: string | null, name: string): string | undefined {
  for (const part of (header ?? "").split(";")) {
    const index = part.indexOf("=");
    if (index > 0 && part.slice(0, index).trim() === name) {
      return decodeURIComponent(part.slice(index + 1).trim());
    }
  }
  return undefined;
}

/**
 * Route guard for middleware.ts. Returns a redirect (or 403) for protected paths
 * without a valid session, and undefined to let the request through.
 *
 *   // middleware.ts
 *   import { NextResponse } from "next/server";
 *   import { authMiddleware } from "@bakorin/sdk/next";
 *   const guard = authMiddleware({ baseUrl: process.env.BAKORIN_URL!, protect: ["/app"] });
 *   export async function middleware(request: Request) {
 *     return (await guard(request)) ?? NextResponse.next();
 *   }
 */
export function authMiddleware(options: GuardOptions & { baseUrl: string; fetch?: typeof fetch }) {
  const { baseUrl, fetch: fetcher = fetch, ...guard } = options;
  return async (request: Request): Promise<Response | undefined> => {
    const url = new URL(request.url);
    if (!isProtected(url.pathname, guard.protect)) {
      return undefined;
    }
    const renew = Response.redirect(new URL(refreshUrl(url.pathname + url.search, guard), url), 307);
    const token = cookieValue(request.headers.get("cookie"), "bakorin_access");
    if (!token) {
      return renew;
    }
    const me = await fetcher(new URL("/api/v1/auth/me", baseUrl), { headers: { authorization: `Bearer ${token}` } }).catch(() => null);
    if (!me?.ok) {
      return renew;
    }
    if (guard.roles) {
      const body = (await me.json().catch(() => ({}))) as { data?: unknown };
      if (!hasRole(body.data, guard.roles)) {
        return forbidden();
      }
    }
    return undefined;
  };
}

/**
 * For server components and actions: the signed in user, or a redirect through
 * the refresh route. Pass redirect from next/navigation.
 *
 *   const user = await requireUser(await api(), { redirect, next: "/app" });
 */
export async function requireUser<U = Record<string, unknown>>(
  client: { me(): Promise<unknown> },
  options: Omit<GuardOptions, "protect"> & { redirect: (url: string) => never; next?: string },
): Promise<U> {
  const user = await client.me().catch(() => null);
  if (!user) {
    options.redirect(refreshUrl(options.next ?? "/", options));
  }
  if (!hasRole(user, options.roles)) {
    options.redirect(options.loginPath ?? "/login");
  }
  return user as U;
}
