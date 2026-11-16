import { createClient, type AuthTokens, type ClientOptions } from "./index.ts";
import { createProxyHandler, type ProxyOptions } from "./proxy.ts";
export { createProxyHandler, isSameSiteRequest, type ProxyOptions } from "./proxy.ts";

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
  },
) {
  return createClient<S>({
    ...options,
    getAccessToken: () => options.cookies.get("bakorin_access")?.value ?? null,
    getRefreshToken: () => options.cookies.get("bakorin_refresh")?.value ?? null,
    setTokens: (tokens: AuthTokens) => {
      options.cookies.set?.("bakorin_access", tokens.accessToken, { httpOnly: true, sameSite: "lax", path: "/" });
      options.cookies.set?.("bakorin_refresh", tokens.refreshToken, { httpOnly: true, sameSite: "lax", path: "/" });
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
  const handle = createProxyHandler(options);
  const route = (request: Request) => handle(request);
  return { GET: route, POST: route, PATCH: route, PUT: route, DELETE: route, HEAD: route };
}
