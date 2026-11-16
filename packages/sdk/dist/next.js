import {
  visitorHeaders2,
  envProxySecret2,
  createClient2
} from "./chunks/index-1qcntxcm.js";
import {
  rightmostForwardedFor2,
  isSameSiteRequest2,
  createProxyHandler2
} from "./chunks/index-4ske5nsk.js";
import {
  isProtected2,
  refreshUrl2,
  hasRole,
  forbidden
} from "./chunks/index-17mbgmee.js";
import {
  loadBrandingTheme2
} from "./chunks/index-n603vnp4.js";
// src/next.ts
var DEFAULT_PROXY_PREFIX = "/api/bakorin";
function createNextClient(options) {
  const { clientIp, proxySecret, refreshPath = DEFAULT_PROXY_PREFIX, ...rest } = options;
  return createClient2({
    ...rest,
    headers: { ...rest.headers, ...visitorHeaders2(clientIp, proxySecret ?? envProxySecret2()) },
    getAccessToken: () => options.cookies.get("bakorin_access")?.value ?? null,
    getRefreshToken: () => options.cookies.get("bakorin_refresh")?.value ?? null,
    setTokens: (tokens) => {
      options.cookies.set?.("bakorin_access", tokens.accessToken, { httpOnly: true, sameSite: "lax", path: "/", maxAge: tokens.expiresIn });
      options.cookies.set?.("bakorin_refresh", tokens.refreshToken, { httpOnly: true, sameSite: "lax", path: refreshPath, maxAge: 30 * 24 * 3600 });
    }
  });
}
function createNextProxy(options) {
  const handle = createProxyHandler2({ getClientIp: rightmostForwardedFor2, ...options });
  const route = (request) => handle(request);
  return { GET: route, POST: route, PATCH: route, PUT: route, DELETE: route, HEAD: route };
}
function cookieValue(header, name) {
  for (const part of (header ?? "").split(";")) {
    const index = part.indexOf("=");
    if (index > 0 && part.slice(0, index).trim() === name) {
      return decodeURIComponent(part.slice(index + 1).trim());
    }
  }
  return;
}
function authMiddleware(options) {
  const { baseUrl, fetch: fetcher = fetch, ...guard } = options;
  return async (request) => {
    const url = new URL(request.url);
    if (!isProtected2(url.pathname, guard.protect)) {
      return;
    }
    const renew = Response.redirect(new URL(refreshUrl2(url.pathname + url.search, guard), url), 307);
    const token = cookieValue(request.headers.get("cookie"), "bakorin_access");
    if (!token) {
      return renew;
    }
    const me = await fetcher(new URL("/api/v1/auth/me", baseUrl), { headers: { authorization: `Bearer ${token}` } }).catch(() => null);
    if (!me?.ok) {
      return renew;
    }
    if (guard.roles) {
      const body = await me.json().catch(() => ({}));
      if (!hasRole(body.data, guard.roles)) {
        return forbidden();
      }
    }
    return;
  };
}
async function requireUser(client, options) {
  const user = await client.me().catch(() => null);
  if (!user) {
    options.redirect(refreshUrl2(options.next ?? "/", options));
  }
  if (!hasRole(user, options.roles)) {
    options.redirect(options.loginPath ?? "/login");
  }
  return user;
}
export {
  DEFAULT_PROXY_PREFIX,
  authMiddleware,
  createNextClient,
  createNextProxy,
  createProxyHandler2 as createProxyHandler,
  isProtected2 as isProtected,
  isSameSiteRequest2 as isSameSiteRequest,
  loadBrandingTheme2 as loadBrandingTheme,
  refreshUrl2 as refreshUrl,
  requireUser,
  rightmostForwardedFor2 as rightmostForwardedFor
};
