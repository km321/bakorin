import { createClient, type AuthTokens, type ClientOptions } from "./index.ts";

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
