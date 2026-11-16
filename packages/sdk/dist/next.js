// src/index.ts
var API_PREFIX = "/api/v1";
function createClient(options) {
  const fetcher = options.fetch ?? ((input, init) => fetch(input, init));
  let refreshMutex = null;
  const base = options.baseUrl.replace(/\/+$/, "");
  const apiPath = (options.apiPath ?? API_PREFIX).replace(/\/+$/, "");
  function url(path) {
    const rest = path.startsWith(API_PREFIX) ? path.slice(API_PREFIX.length) : path;
    return `${base}${apiPath}${rest}`;
  }
  async function token() {
    return options.getAccessToken ? await options.getAccessToken() : null;
  }
  async function refresh() {
    if (refreshMutex) {
      return refreshMutex;
    }
    refreshMutex = (async () => {
      const current = options.getRefreshToken ? await options.getRefreshToken() : null;
      if (!current) {
        return null;
      }
      const response = await fetcher(url("/api/v1/auth/refresh"), {
        method: "POST",
        credentials: options.credentials,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: current })
      });
      if (!response.ok) {
        return null;
      }
      const json = await response.json();
      await options.setTokens?.(json.data);
      return json.data.accessToken;
    })().finally(() => {
      refreshMutex = null;
    });
    return refreshMutex;
  }
  async function request(path, init = {}, retried = false) {
    const headers = new Headers(init.headers);
    const access = await token();
    if (access) {
      headers.set("authorization", `Bearer ${access}`);
    }
    if (init.body && !headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }
    const response = await fetcher(url(path), { credentials: options.credentials, ...init, headers });
    if (response.status === 401 && !retried) {
      const next = await refresh();
      if (next) {
        return request(path, init, true);
      }
    }
    return response;
  }
  function queryString(query = {}) {
    const search = new URLSearchParams;
    if (query.limit) {
      search.set("limit", String(query.limit));
    }
    if (query.offset) {
      search.set("offset", String(query.offset));
    }
    if (query.sort) {
      search.set("sort", query.sort);
    }
    if (query.expand) {
      search.set("expand", query.expand);
    }
    for (const [key, value] of Object.entries(query.filter ?? {})) {
      if (typeof value === "object" && value && "op" in value) {
        search.set(`filter[${key}][${value.op}]`, String(value.value));
      } else {
        search.set(`filter[${key}]`, String(value));
      }
    }
    const text = search.toString();
    return text ? `?${text}` : "";
  }
  async function parse(response) {
    const json = await response.json();
    if (!response.ok) {
      throw new Error(json.error?.message ?? `request failed (${response.status})`);
    }
    return json;
  }
  const realtime = createRealtimeConnection({
    open: async (entities, lastEventId, signal) => {
      const headers = new Headers({ accept: "text/event-stream" });
      const access = await token();
      if (access)
        headers.set("authorization", `Bearer ${access}`);
      if (lastEventId)
        headers.set("last-event-id", lastEventId);
      return fetcher(url(`/api/v1/realtime?entities=${encodeURIComponent(entities.join(","))}`), {
        headers,
        signal,
        cache: "no-store",
        credentials: options.credentials
      });
    },
    refresh: options.getRefreshToken ? refresh : null
  });
  return {
    subscribe(entity, handler, subscribeOptions = {}) {
      return realtime.add(entity, handler, subscribeOptions);
    },
    closeRealtime() {
      realtime.closeAll();
    },
    async signup(body) {
      const json = await parse(await request("/api/v1/auth/signup", { method: "POST", body: JSON.stringify(body) }));
      return json.data;
    },
    async login(body) {
      const json = await parse(await request("/api/v1/auth/login", { method: "POST", body: JSON.stringify(body) }));
      await options.setTokens?.(json.data);
      return json.data;
    },
    async logout(refreshToken, logoutOptions = {}) {
      await request("/api/v1/auth/logout", { method: "POST", body: JSON.stringify({ refreshToken, all: logoutOptions.all }) });
      realtime.restart(true);
    },
    async me() {
      const json = await parse(await request("/api/v1/auth/me"));
      return json.data;
    },
    async forgotPassword(body) {
      const json = await parse(await request("/api/v1/auth/forgot-password", { method: "POST", body: JSON.stringify(body) }));
      return json.data;
    },
    async resetPassword(body) {
      const json = await parse(await request("/api/v1/auth/reset-password", { method: "POST", body: JSON.stringify(body) }));
      return json.data;
    },
    async verifyEmail(body) {
      const json = await parse(await request("/api/v1/auth/verify-email", { method: "POST", body: JSON.stringify(body) }));
      return json.data;
    },
    async acceptInvite(body) {
      const json = await parse(await request("/api/v1/auth/accept-invite", { method: "POST", body: JSON.stringify(body) }));
      await options.setTokens?.(json.data);
      return json.data;
    },
    async invite(body) {
      const json = await parse(await request("/api/v1/auth/invites", { method: "POST", body: JSON.stringify(body) }));
      return json.data;
    },
    async resendVerification(body = {}) {
      const json = await parse(await request("/api/v1/auth/resend-verification", { method: "POST", body: JSON.stringify(body) }));
      return json.data;
    },
    entity(name) {
      return {
        async list(query) {
          return parse(await request(`/api/v1/${name}${queryString(query)}`));
        },
        async get(id, expand) {
          const json = await parse(await request(`/api/v1/${name}/${id}${expand ? `?expand=${expand}` : ""}`));
          return json.data;
        },
        async create(body) {
          const json = await parse(await request(`/api/v1/${name}`, { method: "POST", body: JSON.stringify(body) }));
          return json.data;
        },
        async update(id, body) {
          const json = await parse(await request(`/api/v1/${name}/${id}`, { method: "PATCH", body: JSON.stringify(body) }));
          return json.data;
        },
        async delete(id) {
          await parse(await request(`/api/v1/${name}/${id}`, { method: "DELETE" }));
        }
      };
    }
  };
}
async function readEventStream(body, onFrame) {
  const reader = body.getReader();
  const decoder = new TextDecoder;
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done)
        break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n?/g, `
`);
      let index;
      while ((index = buffer.indexOf(`

`)) >= 0) {
        const block = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        const frame = { event: "message", data: "" };
        let any = false;
        for (const line of block.split(`
`)) {
          if (!line || line.startsWith(":"))
            continue;
          const colon = line.indexOf(":");
          const field = colon < 0 ? line : line.slice(0, colon);
          const value = colon < 0 ? "" : line.slice(colon + 1).replace(/^ /, "");
          any = true;
          if (field === "id")
            frame.id = value;
          else if (field === "event")
            frame.event = value;
          else if (field === "data")
            frame.data += (frame.data ? `
` : "") + value;
          else if (field === "retry" && /^\d+$/.test(value))
            frame.retry = Number(value);
        }
        if (any)
          onFrame(frame);
      }
    }
  } finally {
    reader.releaseLock();
  }
}

class StreamError extends Error {
  retry;
  constructor(message, retry) {
    super(message);
    this.retry = retry;
  }
}
function createRealtimeConnection(deps) {
  const listeners = new Map;
  let lastEventId;
  let generation = 0;
  let controller = null;
  let restartTimer = null;
  let status = "closed";
  const allListeners = () => [...listeners.values()].flatMap((set) => [...set]);
  const setStatus = (next) => {
    if (next === status)
      return;
    status = next;
    for (const listener of allListeners())
      listener.options.onStatus?.(next);
  };
  const sleep = (ms, signal) => new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    });
  });
  async function run(gen, signal) {
    let attempt = 0;
    let refreshed = false;
    while (gen === generation && !signal.aborted) {
      const entities = [...listeners.keys()].sort();
      if (entities.length === 0)
        return;
      setStatus(attempt === 0 ? "connecting" : "reconnecting");
      let waitMs = Math.min(30000, 500 * 2 ** attempt) * (0.5 + Math.random() * 0.5);
      try {
        const response = await deps.open(entities, lastEventId, signal);
        if (response.status === 401 && deps.refresh && !refreshed) {
          refreshed = true;
          await response.body?.cancel().catch(() => {
            return;
          });
          if (await deps.refresh())
            continue;
        }
        if (response.status === 400 || response.status === 401 || response.status === 403 || response.status === 404) {
          const json = await response.json().catch(() => ({}));
          throw new StreamError(json.error?.message ?? `realtime refused (${response.status})`, false);
        }
        if (!response.ok || !response.body) {
          const after = Number(response.headers.get("retry-after"));
          if (Number.isFinite(after) && after > 0)
            waitMs = after * 1000 * (1 + Math.random());
          await response.body?.cancel().catch(() => {
            return;
          });
          throw new StreamError(`realtime unavailable (${response.status})`, true);
        }
        let serverRetry;
        await readEventStream(response.body, (frame) => {
          if (frame.retry !== undefined)
            serverRetry = frame.retry;
          if (frame.id)
            lastEventId = frame.id;
          if (frame.event === "ready") {
            attempt = 0;
            refreshed = false;
            setStatus("open");
          } else if (frame.event === "change") {
            const data = JSON.parse(frame.data);
            const change = { ...data, eventId: frame.id ?? "" };
            for (const listener of [...listeners.get(change.entity) ?? []]) {
              try {
                listener.handler(change);
              } catch (error) {
                console.error("[bakorin] realtime handler failed", error);
              }
            }
          } else if (frame.event === "reset") {
            for (const listener of allListeners())
              listener.options.onReset?.();
          }
        });
        if (serverRetry !== undefined)
          waitMs = serverRetry;
        attempt += 1;
      } catch (error) {
        if (signal.aborted || gen !== generation)
          return;
        if (error instanceof StreamError && !error.retry) {
          for (const listener of allListeners())
            listener.options.onError?.(error);
          setStatus("closed");
          return;
        }
        attempt += 1;
      }
      if (gen !== generation || signal.aborted)
        return;
      setStatus("reconnecting");
      await sleep(waitMs, signal);
    }
  }
  function restart(resetPosition = false) {
    if (restartTimer)
      clearTimeout(restartTimer);
    restartTimer = setTimeout(() => {
      restartTimer = null;
      generation += 1;
      controller?.abort();
      controller = null;
      if (resetPosition)
        lastEventId = undefined;
      if (listeners.size === 0) {
        setStatus("closed");
        return;
      }
      const next = new AbortController;
      controller = next;
      run(generation, next.signal);
    }, 10);
  }
  return {
    add(entity, handler, options) {
      const listener = { handler, options };
      let set = listeners.get(entity);
      const isNewEntity = !set;
      if (!set)
        listeners.set(entity, set = new Set);
      set.add(listener);
      if (isNewEntity || !controller)
        restart();
      return () => {
        const current = listeners.get(entity);
        if (!current?.delete(listener))
          return;
        if (current.size === 0) {
          listeners.delete(entity);
          restart();
        }
      };
    },
    restart,
    closeAll() {
      listeners.clear();
      restart(true);
    }
  };
}

// src/proxy.ts
var SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
var FORWARD_REQUEST_HEADERS = ["accept", "content-type", "last-event-id", "if-none-match", "x-request-id"];
var FORWARD_RESPONSE_HEADERS = [
  "content-type",
  "cache-control",
  "content-disposition",
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
function isSameSiteRequest(request, allowedOrigins = []) {
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
function createProxyHandler(options) {
  const base = options.baseUrl.replace(/\/+$/, "");
  const prefix = (options.prefix ?? "/api/bakorin").replace(/\/+$/, "");
  const accessName = options.cookies?.access ?? "bakorin_access";
  const refreshName = options.cookies?.refresh ?? "bakorin_refresh";
  const refreshMaxAge = options.cookies?.refreshMaxAge ?? 30 * 24 * 3600;
  const fetcher = options.fetch ?? ((input, init) => fetch(input, init));
  function cookie(request, name, value, maxAge) {
    const secure = options.cookies?.secure ?? new URL(request.url).protocol === "https:";
    return [
      `${name}=${encodeURIComponent(value)}`,
      "Path=/",
      "HttpOnly",
      `SameSite=${options.cookies?.sameSite ?? "Lax"}`,
      `Max-Age=${maxAge}`,
      secure ? "Secure" : ""
    ].filter(Boolean).join("; ");
  }
  async function refreshTokens(refreshToken, ip) {
    const headers = { "content-type": "application/json" };
    if (ip)
      headers["x-forwarded-for"] = ip;
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
    if (segments.some((segment) => segment === ".." || segment === "." || segment.includes("\\")) || rest.includes("//")) {
      return json(400, "invalid_path", "invalid path");
    }
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
        setCookies.push(cookie(request, accessName, "", 0), cookie(request, refreshName, "", 0));
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
      if (ip)
        headers.set("x-forwarded-for", ip);
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
          setCookies.push(cookie(request, accessName, tokens.accessToken, tokens.expiresIn), cookie(request, refreshName, tokens.refreshToken, refreshMaxAge));
          upstream = await send(access);
        } else {
          setCookies.push(cookie(request, accessName, "", 0), cookie(request, refreshName, "", 0));
        }
      }
    } catch (error) {
      if (request.signal.aborted)
        return new Response(null, { status: 499 });
      return json(502, "upstream_unavailable", error instanceof Error ? error.message : "Bakorin is unreachable");
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
          setCookies.push(cookie(request, accessName, data.accessToken, expiresIn), cookie(request, refreshName, data.refreshToken, refreshMaxAge));
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

// src/next.ts
function createNextClient(options) {
  return createClient({
    ...options,
    getAccessToken: () => options.cookies.get("bakorin_access")?.value ?? null,
    getRefreshToken: () => options.cookies.get("bakorin_refresh")?.value ?? null,
    setTokens: (tokens) => {
      options.cookies.set?.("bakorin_access", tokens.accessToken, { httpOnly: true, sameSite: "lax", path: "/" });
      options.cookies.set?.("bakorin_refresh", tokens.refreshToken, { httpOnly: true, sameSite: "lax", path: "/" });
    }
  });
}
function createNextProxy(options) {
  const handle = createProxyHandler(options);
  const route = (request) => handle(request);
  return { GET: route, POST: route, PATCH: route, PUT: route, DELETE: route, HEAD: route };
}
export {
  createNextClient,
  createNextProxy,
  createProxyHandler,
  isSameSiteRequest
};
