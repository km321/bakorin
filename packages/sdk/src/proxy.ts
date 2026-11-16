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
 * - Streams responses through without buffering, including realtime (SSE).
 *
 * Framework neutral: it takes a Request and returns a Response. See
 * createAstroProxy (./astro) and createNextProxy (./next).
 */

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
  };
  /** Forward the visitor IP as X-Forwarded-For (only when Bakorin trusts your proxy). */
  getClientIp?: (request: Request) => string | undefined;
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
  const fetcher = options.fetch ?? ((input: string, init: RequestInit) => fetch(input, init));

  function cookie(request: Request, name: string, value: string, maxAge: number): string {
    const secure = options.cookies?.secure ?? new URL(request.url).protocol === "https:";
    return [
      `${name}=${encodeURIComponent(value)}`,
      "Path=/",
      "HttpOnly",
      `SameSite=${options.cookies?.sameSite ?? "Lax"}`,
      `Max-Age=${maxAge}`,
      secure ? "Secure" : "",
    ]
      .filter(Boolean)
      .join("; ");
  }

  async function refreshTokens(refreshToken: string, ip: string | undefined) {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (ip) headers["x-forwarded-for"] = ip;
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
    if (!isSameSiteRequest(request, options.allowedOrigins)) {
      return json(403, "csrf", "cross-site request blocked");
    }

    const cookies = parseCookies(request.headers.get("cookie"));
    let access = cookies.get(accessName);
    const refresh = cookies.get(refreshName);
    const ip = options.getClientIp?.(request);
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
        setCookies.push(cookie(request, accessName, "", 0), cookie(request, refreshName, "", 0));
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
      if (ip) headers.set("x-forwarded-for", ip);
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
          setCookies.push(
            cookie(request, accessName, tokens.accessToken, tokens.expiresIn),
            cookie(request, refreshName, tokens.refreshToken, refreshMaxAge),
          );
          upstream = await send(access);
        } else {
          setCookies.push(cookie(request, accessName, "", 0), cookie(request, refreshName, "", 0));
        }
      }
    } catch (error) {
      if (request.signal.aborted) return new Response(null, { status: 499 });
      return json(502, "upstream_unavailable", error instanceof Error ? error.message : "Bakorin is unreachable");
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
          setCookies.push(
            cookie(request, accessName, data.accessToken, expiresIn),
            cookie(request, refreshName, data.refreshToken, refreshMaxAge),
          );
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
