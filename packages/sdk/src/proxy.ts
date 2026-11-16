/**
 * A same-origin pass through for browser code. The browser talks to a route on
 * your site (for example /api/bakorin/...), and this handler forwards the call to
 * Bakorin with the access token from an httpOnly cookie. Tokens never reach
 * browser JavaScript.
 *
 * What it does:
 * - Rejects cross-site writes (CSRF): POST, PATCH, PUT and DELETE need an Origin
 *   that matches the site (or allowedOrigins), or Sec-Fetch-Site: same-origin.
 * - Refreshes an expired access token once with the refresh cookie and retries.
 * - Turns tokens in auth responses (login, signup verification, accept invite)
 *   into httpOnly cookies and strips them from the body.
 * - Sends the refresh cookie on logout and clears both cookies.
 * - Names the visitor IP to Bakorin with BAKORIN_PROXY_SECRET, so lockouts and
 *   rate limits apply per visitor instead of to the whole site.
 * - Keeps the refresh cookie on the route path only. Pages refresh through
 *   GET {prefix}/-/refresh?next=/page, and GET {prefix}/-/logout signs out.
 * - Streams responses through without buffering, including realtime (SSE).
 *
 * Framework neutral: it takes a Request and returns a Response. See
 * createAstroProxy (./astro) and createNextProxy (./next).
 */

import { envProxySecret, visitorHeaders } from "./index.ts";

export interface ProxyOptions {
  /** The Bakorin server, for example http://localhost:3000 or process.env.BAKORIN_URL. */
  baseUrl: string;
  /** The route this handler is mounted on. Default /api/bakorin. */
  prefix?: string;
  /** Extra origins allowed to send writes (for example a preview domain). The site's own origin is always allowed. */
  allowedOrigins?: string[];
  /** Cookie names and attributes. */
  cookies?: {
    access?: string;
    refresh?: string;
    /** Force the Secure flag. Default: on when the request is https. */
    secure?: boolean;
    sameSite?: "Lax" | "Strict";
    /** Refresh cookie lifetime in seconds. Default 30 days (match runtime.refreshTtlSeconds). */
    refreshMaxAge?: number;
    /** Path of the refresh cookie. Default: the route prefix, so the token only goes to this route. */
    refreshPath?: string;
  };
  /**
   * The visitor IP. createAstroProxy uses Astro's clientAddress and createNextProxy
   * the right end of X-Forwarded-For. Bakorin trusts it only with proxySecret.
   */
  getClientIp?: (request: Request) => string | undefined;
  /** Shared with the Bakorin server as BAKORIN_PROXY_SECRET (32+ characters). Default: process.env.BAKORIN_PROXY_SECRET. */
  proxySecret?: string;
  /** Where server side errors go. Default console.error. */
  onError?: (error: unknown) => void;
  fetch?: (input: string, init: RequestInit) => Promise<Response>;
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const FORWARD_REQUEST_HEADERS = ["accept", "content-type", "last-event-id", "if-none-match", "x-request-id"];
const FORWARD_RESPONSE_HEADERS = [
  "content-type",
  "cache-control",
  "content-disposition",
  "etag",
  "last-modified",
  "retry-after",
  "x-request-id",
  "x-ratelimit-limit",
  "x-ratelimit-remaining",
  "x-ratelimit-reset",
];

function parseCookies(header: string | null): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of (header ?? "").split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    const name = part.slice(0, index).trim();
    const raw = part.slice(index + 1).trim();
    try {
      out.set(name, decodeURIComponent(raw));
    } catch {
      out.set(name, raw);
    }
  }
  return out;
}

function json(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

/** The host the browser used, honoring a reverse proxy in front of the site. */
function siteHost(request: Request, url: URL): string {
  return (request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || request.headers.get("host") || url.host).toLowerCase();
}

/**
 * The right end of X-Forwarded-For: the address the nearest proxy saw. Correct when
 * your site runs behind one platform or proxy that appends to the header (Vercel,
 * Railway, Netlify, Fly, Render, nginx). Without a proxy in front, the visitor
 * could choose this value, so pass your own getClientIp.
 */
export function rightmostForwardedFor(source: Request | { get: (name: string) => string | null }): string | undefined {
  const headers = "headers" in source && typeof source.headers?.get === "function" ? source.headers : (source as { get: (name: string) => string | null });
  const parts = (headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  return parts[parts.length - 1] || headers.get("x-real-ip")?.trim() || undefined;
}

/** A same-site path to send the browser back to, never another origin. */
function safeNext(raw: string | null, fallback: string): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return fallback;
  return raw;
}

export function isSameSiteRequest(request: Request, allowedOrigins: string[] = []): boolean {
  if (SAFE_METHODS.has(request.method.toUpperCase())) return true;
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  if (origin && origin !== "null") {
    if (allowedOrigins.includes(origin)) return true;
    try {
      return new URL(origin).host.toLowerCase() === siteHost(request, url);
    } catch {
      return false;
    }
  }
  return request.headers.get("sec-fetch-site") === "same-origin";
}

export function createProxyHandler(options: ProxyOptions) {
  const base = options.baseUrl.replace(/\/+$/, "");
  const prefix = (options.prefix ?? "/api/bakorin").replace(/\/+$/, "");
  const accessName = options.cookies?.access ?? "bakorin_access";
  const refreshName = options.cookies?.refresh ?? "bakorin_refresh";
  const refreshMaxAge = options.cookies?.refreshMaxAge ?? 30 * 24 * 3600;
  const refreshPath = options.cookies?.refreshPath ?? (prefix || "/");
  const fetcher = options.fetch ?? ((input: string, init: RequestInit) => fetch(input, init));
  const proxySecret = options.proxySecret ?? envProxySecret();
  const reportError = options.onError ?? ((error: unknown) => console.error("[bakorin] pass through error", error));

  function cookie(request: Request, name: string, value: string, maxAge: number, path = "/"): string {
    const secure = options.cookies?.secure ?? new URL(request.url).protocol === "https:";
    return [
      `${name}=${encodeURIComponent(value)}`,
      `Path=${path}`,
      "HttpOnly",
      `SameSite=${options.cookies?.sameSite ?? "Lax"}`,
      `Max-Age=${maxAge}`,
      secure ? "Secure" : "",
    ]
      .filter(Boolean)
      .join("; ");
  }

  /** Sets both session cookies, and clears a refresh cookie left at Path=/ by older versions. */
  function sessionCookies(request: Request, accessToken: string, refreshToken: string, expiresIn: number): string[] {
    // The old Path=/ cookie is cleared first, so simple cookie jars keep the new one.
    const out = refreshPath !== "/" ? [cookie(request, refreshName, "", 0, "/")] : [];
    out.push(cookie(request, accessName, accessToken, expiresIn), cookie(request, refreshName, refreshToken, refreshMaxAge, refreshPath));
    return out;
  }

  function clearCookies(request: Request): string[] {
    const out = [cookie(request, accessName, "", 0), cookie(request, refreshName, "", 0, refreshPath)];
    if (refreshPath !== "/") out.push(cookie(request, refreshName, "", 0, "/"));
    return out;
  }

  function identity(ip: string | undefined): Record<string, string> {
    const headers: Record<string, string> = { ...visitorHeaders(ip, proxySecret) };
    if (ip) headers["x-forwarded-for"] = ip;
    return headers;
  }

  function redirect(location: string, setCookies: string[]): Response {
    const headers = new Headers({ location, "cache-control": "no-store" });
    for (const value of setCookies) headers.append("set-cookie", value);
    return new Response(null, { status: 303, headers });
  }

  async function refreshTokens(refreshToken: string, ip: string | undefined) {
    const headers: Record<string, string> = { ...identity(ip), "content-type": "application/json" };
    const response = await fetcher(`${base}/api/v1/auth/refresh`, {
      method: "POST",
      headers,
      body: JSON.stringify({ refreshToken }),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { data?: { accessToken?: string; refreshToken?: string; expiresIn?: number } };
    if (!body.data?.accessToken || !body.data.refreshToken) return null;
    return { accessToken: body.data.accessToken, refreshToken: body.data.refreshToken, expiresIn: body.data.expiresIn ?? 900 };
  }

  function visitorIp(request: Request): string | undefined {
    try {
      return options.getClientIp?.(request)?.trim() || undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * GET {prefix}/-/refresh?next=/page&fail=/login renews the session with the
   * refresh cookie (which pages cannot see) and sends the browser back.
   * GET {prefix}/-/logout?next=/ revokes the refresh token and clears both cookies.
   */
  async function sessionRoute(request: Request, url: URL, rest: string, method: string): Promise<Response> {
    if (method !== "GET" && method !== "HEAD") {
      return json(405, "method_not_allowed", "use GET");
    }
    const cookies = parseCookies(request.headers.get("cookie"));
    const refresh = cookies.get(refreshName);
    const ip = visitorIp(request);
    if (rest === "/-/logout") {
      const next = safeNext(url.searchParams.get("next"), "/");
      // A link on another site must not sign people out.
      if (request.headers.get("sec-fetch-site") === "cross-site") {
        return redirect(next, []);
      }
      if (refresh) {
        try {
          const response = await fetcher(`${base}/api/v1/auth/logout`, {
            method: "POST",
            headers: { ...identity(ip), "content-type": "application/json" },
            body: JSON.stringify({ refreshToken: refresh }),
          });
          await response.body?.cancel().catch(() => undefined);
        } catch (error) {
          reportError(error);
        }
      }
      return redirect(next, clearCookies(request));
    }
    const next = safeNext(url.searchParams.get("next"), "/");
    const fail = safeNext(url.searchParams.get("fail"), "/login");
    if (!refresh) {
      return redirect(fail, []);
    }
    try {
      const tokens = await refreshTokens(refresh, ip);
      if (!tokens) {
        return redirect(fail, clearCookies(request));
      }
      return redirect(next, sessionCookies(request, tokens.accessToken, tokens.refreshToken, tokens.expiresIn));
    } catch (error) {
      reportError(error);
      return redirect(fail, []);
    }
  }

  return async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== prefix && !url.pathname.startsWith(`${prefix}/`)) {
      return json(404, "not_found", "not found");
    }
    const rest = url.pathname.slice(prefix.length) || "/";
    let segments: string[];
    try {
      segments = rest.split("/").map((segment) => decodeURIComponent(segment));
    } catch {
      return json(400, "invalid_path", "invalid path");
    }
    if (segments.some((segment) => segment === ".." || segment === "." || segment.includes("\\") || segment.includes("/")) || rest.includes("//")) {
      return json(400, "invalid_path", "invalid path");
    }
    // Token refresh is handled here, never by the browser.
    if (rest === "/auth/refresh") {
      return json(404, "not_found", "not found");
    }
    const method = request.method.toUpperCase();
    if (rest === "/-/refresh" || rest === "/-/logout") {
      return sessionRoute(request, url, rest, method);
    }
    if (!isSameSiteRequest(request, options.allowedOrigins)) {
      return json(403, "csrf", "cross-site request blocked");
    }

    const cookies = parseCookies(request.headers.get("cookie"));
    let access = cookies.get(accessName);
    const refresh = cookies.get(refreshName);
    const ip = visitorIp(request);
    const setCookies: string[] = [];

    let body: ArrayBuffer | string | undefined;
    if (!SAFE_METHODS.has(method)) {
      body = await request.arrayBuffer();
      if (rest === "/auth/logout") {
        let parsed: Record<string, unknown> = {};
        try {
          parsed = body.byteLength ? (JSON.parse(new TextDecoder().decode(body)) as Record<string, unknown>) : {};
        } catch {
          parsed = {};
        }
        body = JSON.stringify({ ...parsed, refreshToken: refresh });
        setCookies.push(...clearCookies(request));
      }
    }

    const send = (token: string | undefined) => {
      const headers = new Headers();
      for (const name of FORWARD_REQUEST_HEADERS) {
        const value = request.headers.get(name);
        if (value) headers.set(name, value);
      }
      if (rest === "/auth/logout") headers.set("content-type", "application/json");
      if (token) headers.set("authorization", `Bearer ${token}`);
      for (const [name, value] of Object.entries(identity(ip))) headers.set(name, value);
      return fetcher(`${base}/api/v1${rest}${url.search}`, {
        method,
        headers,
        body: body as BodyInit | undefined,
        signal: request.signal,
        redirect: "manual",
      });
    };

    let upstream: Response;
    try {
      upstream = await send(access);
      if (upstream.status === 401 && refresh && !rest.startsWith("/auth/")) {
        const tokens = await refreshTokens(refresh, ip);
        if (tokens) {
          await upstream.body?.cancel().catch(() => undefined);
          access = tokens.accessToken;
          setCookies.push(...sessionCookies(request, tokens.accessToken, tokens.refreshToken, tokens.expiresIn));
          upstream = await send(access);
        } else {
          setCookies.push(...clearCookies(request));
        }
      }
    } catch (error) {
      if (request.signal.aborted) return new Response(null, { status: 499 });
      // Details stay in the server log; visitors get a generic message.
      reportError(error);
      return json(502, "upstream_unavailable", "The service is unavailable right now. Please try again shortly.");
    }

    const headers = new Headers();
    for (const name of FORWARD_RESPONSE_HEADERS) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }
    const contentType = upstream.headers.get("content-type") ?? "";
    let responseBody: BodyInit | null = upstream.body;

    if (rest.startsWith("/auth/") && contentType.includes("application/json") && upstream.ok) {
      const text = await upstream.text();
      try {
        const parsed = JSON.parse(text) as { data?: Record<string, unknown> };
        const data = parsed.data;
        if (data && typeof data.accessToken === "string" && typeof data.refreshToken === "string") {
          const expiresIn = typeof data.expiresIn === "number" ? data.expiresIn : 900;
          setCookies.push(...sessionCookies(request, data.accessToken, data.refreshToken, expiresIn));
          const { accessToken: _a, refreshToken: _r, ...safe } = data;
          responseBody = JSON.stringify({ ...parsed, data: safe });
        } else {
          responseBody = text;
        }
      } catch {
        responseBody = text;
      }
    }
    if (contentType.includes("text/event-stream")) {
      headers.set("cache-control", "no-cache, no-transform");
      headers.set("x-accel-buffering", "no");
    } else if (!headers.has("cache-control")) {
      headers.set("cache-control", "no-store");
    }
    for (const value of setCookies) headers.append("set-cookie", value);
    if (upstream.status === 204 || upstream.status === 304) responseBody = null;
    return new Response(responseBody, { status: upstream.status, headers });
  };
}
