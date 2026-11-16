// src/index.ts
class BakorinRequestError2 extends Error {
  status;
  code;
  field;
  constructor(message, status, code, field) {
    super(message);
    this.name = "BakorinRequestError";
    this.status = status;
    this.code = code;
    this.field = field;
  }
}
var PROXY_SECRET_HEADER2 = "x-bakorin-proxy-secret";
var PROXY_CLIENT_IP_HEADER2 = "x-bakorin-client-ip";
function visitorHeaders2(clientIp, proxySecret) {
  const ip = clientIp?.trim();
  const secret = proxySecret?.trim();
  if (!ip || !secret)
    return {};
  return { [PROXY_SECRET_HEADER2]: secret, [PROXY_CLIENT_IP_HEADER2]: ip };
}
function envProxySecret2() {
  const env = globalThis.process?.env;
  return env?.BAKORIN_PROXY_SECRET?.trim() || undefined;
}
var API_PREFIX = "/api/v1";
function createClient2(options) {
  const fetcher = options.fetch ?? ((input, init) => fetch(input, init));
  let refreshMutex = null;
  const base = options.baseUrl.replace(/\/+$/, "");
  const apiPath = (options.apiPath ?? API_PREFIX).replace(/\/+$/, "");
  function fileUrl(path) {
    return path.startsWith("/api/v1/") ? url(path) : path;
  }
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
        headers: { ...options.headers, "content-type": "application/json" },
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
    const headers = new Headers(options.headers);
    new Headers(init.headers).forEach((value, name) => headers.set(name, value));
    const access = await token();
    if (access) {
      headers.set("authorization", `Bearer ${access}`);
    }
    const isForm = typeof FormData !== "undefined" && init.body instanceof FormData;
    if (init.body && !isForm && !headers.has("content-type")) {
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
    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = json.error ?? {};
      throw new BakorinRequestError2(error.message ?? `request failed (${response.status})`, response.status, error.code ?? "error", error.field);
    }
    return json;
  }
  const realtime = createRealtimeConnection({
    open: async (entities, lastEventId, signal) => {
      const headers = new Headers({ ...options.headers, accept: "text/event-stream" });
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
    files: {
      async upload(file, filename) {
        const form = new FormData;
        form.set("file", file, filename ?? file.name ?? "upload");
        const json = await parse(await request("/api/v1/files", { method: "POST", body: form }));
        return { ...json.data, url: fileUrl(json.data.url) };
      },
      async sign(id) {
        const json = await parse(await request(`/api/v1/files/${encodeURIComponent(id)}/sign`, { method: "POST" }));
        return { ...json.data, url: fileUrl(json.data.url) };
      }
    },
    apiUrl(path = "") {
      return url(`/api/v1${path}`);
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
async function readEventStream2(body, onFrame) {
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
        await readEventStream2(response.body, (frame) => {
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

export { BakorinRequestError2, PROXY_SECRET_HEADER2, PROXY_CLIENT_IP_HEADER2, visitorHeaders2, envProxySecret2, createClient2, readEventStream2 };
