import {
  visitorHeaders2,
  envProxySecret2
} from "./index-1qcntxcm.js";

// src/proxy.ts
var SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
var FORWARD_REQUEST_HEADERS = ["accept", "content-type", "last-event-id", "if-none-match", "x-request-id"];
var FORWARD_RESPONSE_HEADERS = [
  "content-type",
  "cache-control",
  "content-disposition",
  "content-security-policy",
  "x-content-type-options",
  "etag",
  "last-modified",
  "retry-after",
  "x-request-id",
  "x-ratelimit-limit",
  "x-ratelimit-remaining",
  "x-ratelimit-reset"
];
function parseCookies(header) {
  const out = new Map;
  for (const part of (header ?? "").split(";")) {
    const index = part.indexOf("=");
    if (index < 0)
      continue;
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
function json(status, code, message) {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" }
  });
}
function siteHost(request, url) {
  return (request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || request.headers.get("host") || url.host).toLowerCase();
}
function rightmostForwardedFor2(source) {
  const headers = "headers" in source && typeof source.headers?.get === "function" ? source.headers : source;
  const parts = (headers.get("x-forwarded-for") ?? "").split(",").map((part) => part.trim()).filter(Boolean);
  return parts[parts.length - 1] || headers.get("x-real-ip")?.trim() || undefined;
}
function safeNext(raw, fallback) {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\"))
    return fallback;
  return raw;
}
function isSameSiteRequest2(request, allowedOrigins = []) {
  if (SAFE_METHODS.has(request.method.toUpperCase()))
    return true;
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  if (origin && origin !== "null") {
    if (allowedOrigins.includes(origin))
      return true;
    try {
      return new URL(origin).host.toLowerCase() === siteHost(request, url);
    } catch {
      return false;
    }
  }
  return request.headers.get("sec-fetch-site") === "same-origin";
}
function createProxyHandler2(options) {
  const base = options.baseUrl.replace(/\/+$/, "");
  const prefix = (options.prefix ?? "/api/bakorin").replace(/\/+$/, "");
  const accessName = options.cookies?.access ?? "bakorin_access";
  const refreshName = options.cookies?.refresh ?? "bakorin_refresh";
  const refreshMaxAge = options.cookies?.refreshMaxAge ?? 30 * 24 * 3600;
  const refreshPath = options.cookies?.refreshPath ?? (prefix || "/");
  const fetcher = options.fetch ?? ((input, init) => fetch(input, init));
  const proxySecret = options.proxySecret ?? envProxySecret2();
  const reportError = options.onError ?? ((error) => console.error("[bakorin] pass through error", error));
  function cookie(request, name, value, maxAge, path = "/") {
    const secure = options.cookies?.secure ?? new URL(request.url).protocol === "https:";
    return [
      `${name}=${encodeURIComponent(value)}`,
      `Path=${path}`,
      "HttpOnly",
      `SameSite=${options.cookies?.sameSite ?? "Lax"}`,
      `Max-Age=${maxAge}`,
      secure ? "Secure" : ""
    ].filter(Boolean).join("; ");
  }
  function sessionCookies(request, accessToken, refreshToken, expiresIn) {
    const out = refreshPath !== "/" ? [cookie(request, refreshName, "", 0, "/")] : [];
    out.push(cookie(request, accessName, accessToken, expiresIn), cookie(request, refreshName, refreshToken, refreshMaxAge, refreshPath));
    return out;
  }
  function clearCookies(request) {
    const out = [cookie(request, accessName, "", 0), cookie(request, refreshName, "", 0, refreshPath)];
    if (refreshPath !== "/")
      out.push(cookie(request, refreshName, "", 0, "/"));
    return out;
  }
  function identity(ip) {
    const headers = { ...visitorHeaders2(ip, proxySecret) };
    if (ip)
      headers["x-forwarded-for"] = ip;
    return headers;
  }
  function redirect(location, setCookies) {
    const headers = new Headers({ location, "cache-control": "no-store" });
    for (const value of setCookies)
      headers.append("set-cookie", value);
    return new Response(null, { status: 303, headers });
  }
  async function refreshTokens(refreshToken, ip) {
    const headers = { ...identity(ip), "content-type": "application/json" };
    const response = await fetcher(`${base}/api/v1/auth/refresh`, {
      method: "POST",
      headers,
      body: JSON.stringify({ refreshToken })
    });
    if (!response.ok)
      return null;
    const body = await response.json();
    if (!body.data?.accessToken || !body.data.refreshToken)
      return null;
    return { accessToken: body.data.accessToken, refreshToken: body.data.refreshToken, expiresIn: body.data.expiresIn ?? 900 };
  }
  function visitorIp(request) {
    try {
      return options.getClientIp?.(request)?.trim() || undefined;
    } catch {
      return;
    }
  }
  async function sessionRoute(request, url, rest, method) {
    if (method !== "GET" && method !== "HEAD") {
      return json(405, "method_not_allowed", "use GET");
    }
    const cookies = parseCookies(request.headers.get("cookie"));
    const refresh = cookies.get(refreshName);
    const ip = visitorIp(request);
    if (rest === "/-/logout") {
      const next = safeNext(url.searchParams.get("next"), "/");
      if (request.headers.get("sec-fetch-site") === "cross-site") {
        return redirect(next, []);
      }
      if (refresh) {
        try {
          const response = await fetcher(`${base}/api/v1/auth/logout`, {
            method: "POST",
            headers: { ...identity(ip), "content-type": "application/json" },
            body: JSON.stringify({ refreshToken: refresh })
          });
          await response.body?.cancel().catch(() => {
            return;
          });
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
  return async function handle(request) {
    const url = new URL(request.url);
    if (url.pathname !== prefix && !url.pathname.startsWith(`${prefix}/`)) {
      return json(404, "not_found", "not found");
    }
    const rest = url.pathname.slice(prefix.length) || "/";
    let segments;
    try {
      segments = rest.split("/").map((segment) => decodeURIComponent(segment));
    } catch {
      return json(400, "invalid_path", "invalid path");
    }
    if (segments.some((segment) => segment === ".." || segment === "." || segment.includes("\\") || segment.includes("/")) || rest.includes("//")) {
      return json(400, "invalid_path", "invalid path");
    }
    if (rest === "/auth/refresh") {
      return json(404, "not_found", "not found");
    }
    const method = request.method.toUpperCase();
    if (rest === "/-/refresh" || rest === "/-/logout") {
      return sessionRoute(request, url, rest, method);
    }
    if (!isSameSiteRequest2(request, options.allowedOrigins)) {
      return json(403, "csrf", "cross-site request blocked");
    }
    const cookies = parseCookies(request.headers.get("cookie"));
    let access = cookies.get(accessName);
    const refresh = cookies.get(refreshName);
    const ip = visitorIp(request);
    const setCookies = [];
    let body;
    if (!SAFE_METHODS.has(method)) {
      body = await request.arrayBuffer();
      if (rest === "/auth/logout") {
        let parsed = {};
        try {
          parsed = body.byteLength ? JSON.parse(new TextDecoder().decode(body)) : {};
        } catch {
          parsed = {};
        }
        body = JSON.stringify({ ...parsed, refreshToken: refresh });
        setCookies.push(...clearCookies(request));
      }
    }
    const send = (token) => {
      const headers = new Headers;
      for (const name of FORWARD_REQUEST_HEADERS) {
        const value = request.headers.get(name);
        if (value)
          headers.set(name, value);
      }
      if (rest === "/auth/logout")
        headers.set("content-type", "application/json");
      if (token)
        headers.set("authorization", `Bearer ${token}`);
      for (const [name, value] of Object.entries(identity(ip)))
        headers.set(name, value);
      return fetcher(`${base}/api/v1${rest}${url.search}`, {
        method,
        headers,
        body,
        signal: request.signal,
        redirect: "manual"
      });
    };
    let upstream;
    try {
      upstream = await send(access);
      if (upstream.status === 401 && refresh && !rest.startsWith("/auth/")) {
        const tokens = await refreshTokens(refresh, ip);
        if (tokens) {
          await upstream.body?.cancel().catch(() => {
            return;
          });
          access = tokens.accessToken;
          setCookies.push(...sessionCookies(request, tokens.accessToken, tokens.refreshToken, tokens.expiresIn));
          upstream = await send(access);
        } else {
          setCookies.push(...clearCookies(request));
        }
      }
    } catch (error) {
      if (request.signal.aborted)
        return new Response(null, { status: 499 });
      reportError(error);
      return json(502, "upstream_unavailable", "The service is unavailable right now. Please try again shortly.");
    }
    const headers = new Headers;
    for (const name of FORWARD_RESPONSE_HEADERS) {
      const value = upstream.headers.get(name);
      if (value)
        headers.set(name, value);
    }
    const contentType = upstream.headers.get("content-type") ?? "";
    let responseBody = upstream.body;
    if (rest.startsWith("/auth/") && contentType.includes("application/json") && upstream.ok) {
      const text = await upstream.text();
      try {
        const parsed = JSON.parse(text);
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
    for (const value of setCookies)
      headers.append("set-cookie", value);
    if (upstream.status === 204 || upstream.status === 304)
      responseBody = null;
    return new Response(responseBody, { status: upstream.status, headers });
  };
}

export { rightmostForwardedFor2, isSameSiteRequest2, createProxyHandler2 };
