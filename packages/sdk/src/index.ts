export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

/** What signup answers, for new and existing emails alike. */
export interface SignupResult {
  ok: true;
  status: "check_email";
  /** True when the app requires a verified email before sign in. */
  requiresVerification: boolean;
  message: string;
}

/**
 * Thrown for an error answer from Bakorin. The message is the server's message,
 * so code that only reads error.message keeps working.
 */
export class BakorinRequestError extends Error {
  /** HTTP status, for example 400, 401, 403, 404, 409, or 429. */
  readonly status: number;
  /** Machine readable code from the server, for example invalid_input or conflict. */
  readonly code: string;
  /** The input field the error is about, when the server names one. */
  readonly field?: string;
  constructor(message: string, status: number, code: string, field?: string) {
    super(message);
    this.name = "BakorinRequestError";
    this.status = status;
    this.code = code;
    this.field = field;
  }
}

/** A stored file, as the upload route answers. url is a signed link that expires at expiresAt (seconds). */
export interface UploadedFile {
  id: string;
  key: string;
  filename: string;
  contentType: string;
  size: number;
  url: string;
  expiresAt: number;
}

export interface ListResult<T> {
  data: T[];
  meta: { total: number; limit: number; offset: number };
}

export interface ClientOptions {
  baseUrl: string;
  /**
   * Where the Bakorin API lives under baseUrl. Default /api/v1. The browser client
   * sets this to the pass through route, for example /api/bakorin.
   */
  apiPath?: string;
  /** fetch credentials mode. The browser client uses same-origin so the httpOnly cookies go along. */
  credentials?: RequestCredentials;
  getAccessToken?: () => Promise<string | null> | string | null;
  getRefreshToken?: () => Promise<string | null> | string | null;
  setTokens?: (tokens: AuthTokens) => Promise<void> | void;
  fetch?: (input: RequestInfo | URL, init?: RequestInit) => Response | Promise<Response>;
  /**
   * Extra headers sent with every call, including token refresh and realtime. The
   * server helpers use this to name the visitor IP (see visitorHeaders).
   */
  headers?: Record<string, string>;
}

/** Headers a site sends so Bakorin keys lockouts and rate limits on the visitor, not the site server. */
export const PROXY_SECRET_HEADER = "x-bakorin-proxy-secret";
export const PROXY_CLIENT_IP_HEADER = "x-bakorin-client-ip";

/**
 * The visitor headers for a server side call, or an empty object when the IP or
 * the secret (BAKORIN_PROXY_SECRET, shared with the Bakorin server) is missing.
 */
export function visitorHeaders(clientIp: string | null | undefined, proxySecret: string | null | undefined): Record<string, string> {
  const ip = clientIp?.trim();
  const secret = proxySecret?.trim();
  if (!ip || !secret) return {};
  return { [PROXY_SECRET_HEADER]: secret, [PROXY_CLIENT_IP_HEADER]: ip };
}

/** BAKORIN_PROXY_SECRET from the environment, when there is one. */
export function envProxySecret(): string | undefined {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  return env?.BAKORIN_PROXY_SECRET?.trim() || undefined;
}

export interface Query {
  limit?: number;
  offset?: number;
  sort?: string;
  expand?: string;
  filter?: Record<string, string | number | boolean | { op: string; value: unknown }>;
}

export type Entities = Record<string, Record<string, unknown>>;

/** One change from a realtime stream, as the signed in reader may see it. */
export interface RealtimeChange<T = Record<string, unknown>> {
  /** The event id. The SDK resumes from the last one after a reconnect. */
  eventId: string;
  entity: string;
  op: "create" | "update" | "delete";
  /** Record id. */
  id: string;
  /** The record for create and update on entities with realtime: true. Absent for delete and for realtime: ids. */
  record?: T;
  /** Commit time in milliseconds. */
  at: number;
}

export type RealtimeStatus = "connecting" | "open" | "reconnecting" | "closed";

export interface SubscribeOptions {
  /** Too many events were missed to replay (a long disconnect): refetch your list. */
  onReset?: () => void;
  onStatus?: (status: RealtimeStatus) => void;
  /** A stream error that will not be retried (unknown entity, no access). */
  onError?: (error: Error) => void;
}

const API_PREFIX = "/api/v1";

export function createClient<S extends object = Entities>(options: ClientOptions) {
  const fetcher = options.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  let refreshMutex: Promise<string | null> | null = null;
  const base = options.baseUrl.replace(/\/+$/, "");
  const apiPath = (options.apiPath ?? API_PREFIX).replace(/\/+$/, "");

  /** Signed file links come back as /api/v1/files/...; point them at this client's base (your site in the browser). */
  function fileUrl(path: string): string {
    return path.startsWith("/api/v1/") ? url(path) : path;
  }

  /** Maps an /api/v1/... route onto baseUrl + apiPath. */
  function url(path: string): string {
    const rest = path.startsWith(API_PREFIX) ? path.slice(API_PREFIX.length) : path;
    return `${base}${apiPath}${rest}`;
  }

  async function token(): Promise<string | null> {
    return options.getAccessToken ? await options.getAccessToken() : null;
  }

  async function refresh(): Promise<string | null> {
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
        body: JSON.stringify({ refreshToken: current }),
      });
      if (!response.ok) {
        return null;
      }
      const json = (await response.json()) as { data: AuthTokens };
      await options.setTokens?.(json.data);
      return json.data.accessToken;
    })().finally(() => {
      refreshMutex = null;
    });
    return refreshMutex;
  }

  async function request(path: string, init: RequestInit = {}, retried = false): Promise<Response> {
    const headers = new Headers(options.headers);
    new Headers(init.headers).forEach((value, name) => headers.set(name, value));
    const access = await token();
    if (access) {
      headers.set("authorization", `Bearer ${access}`);
    }
    // FormData (file uploads) sets its own multipart content type.
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

  function queryString(query: Query = {}): string {
    const search = new URLSearchParams();
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

  async function parse<T>(response: Response): Promise<T> {
    const json = (await response.json().catch(() => ({}))) as { error?: { message?: string; code?: string; field?: string } };
    if (!response.ok) {
      const error = json.error ?? {};
      throw new BakorinRequestError(error.message ?? `request failed (${response.status})`, response.status, error.code ?? "error", error.field);
    }
    return json as T;
  }

  const realtime = createRealtimeConnection({
    open: async (entities, lastEventId, signal) => {
      const headers = new Headers({ ...options.headers, accept: "text/event-stream" });
      const access = await token();
      if (access) headers.set("authorization", `Bearer ${access}`);
      if (lastEventId) headers.set("last-event-id", lastEventId);
      return fetcher(url(`/api/v1/realtime?entities=${encodeURIComponent(entities.join(","))}`), {
        headers,
        signal,
        cache: "no-store",
        credentials: options.credentials,
      });
    },
    refresh: options.getRefreshToken ? refresh : null,
  });

  return {
    /**
     * Live changes for an entity with realtime on in app.yaml. Every subscription on
     * one client shares a single stream, which reconnects with backoff and resumes
     * from the last event id. Returns a function that unsubscribes.
     *
     *   const stop = api.subscribe("tasks", (change) => { ... });
     */
    subscribe<K extends keyof S & string>(
      entity: K,
      handler: (change: RealtimeChange<S[K]>) => void,
      subscribeOptions: SubscribeOptions = {},
    ): () => void {
      return realtime.add(entity, handler as (change: RealtimeChange) => void, subscribeOptions);
    },
    /** Close the shared realtime stream (subscriptions are dropped). */
    closeRealtime() {
      realtime.closeAll();
    },
    /**
     * Starts a signup. The server answers the same way whether or not the email is
     * already registered, and never returns a session: check the email, then call login().
     */
    async signup(body: Record<string, unknown>): Promise<SignupResult> {
      const json = await parse<{ data: SignupResult }>(
        await request("/api/v1/auth/signup", { method: "POST", body: JSON.stringify(body) }),
      );
      return json.data;
    },
    async login(body: Record<string, unknown>) {
      const json = await parse<{ data: { user: S[keyof S]; accessToken: string; refreshToken: string; expiresIn: number } }>(
        await request("/api/v1/auth/login", { method: "POST", body: JSON.stringify(body) }),
      );
      await options.setTokens?.(json.data);
      return json.data;
    },
    async logout(refreshToken?: string, logoutOptions: { all?: boolean } = {}) {
      await request("/api/v1/auth/logout", { method: "POST", body: JSON.stringify({ refreshToken, all: logoutOptions.all }) });
      // The stream was opened as this user: reconnect as signed out (or stop, for private entities).
      realtime.restart(true);
    },
    async me() {
      const json = await parse<{ data: S[keyof S] }>(await request("/api/v1/auth/me"));
      return json.data;
    },
    async forgotPassword(body: { email: string }) {
      const json = await parse<{ data: { ok: boolean } }>(
        await request("/api/v1/auth/forgot-password", { method: "POST", body: JSON.stringify(body) }),
      );
      return json.data;
    },
    async resetPassword(body: { token: string; password: string }) {
      const json = await parse<{ data: { ok: boolean } }>(
        await request("/api/v1/auth/reset-password", { method: "POST", body: JSON.stringify(body) }),
      );
      return json.data;
    },
    async verifyEmail(body: { token: string }) {
      const json = await parse<{ data: { ok: boolean } }>(
        await request("/api/v1/auth/verify-email", { method: "POST", body: JSON.stringify(body) }),
      );
      return json.data;
    },
    async acceptInvite(body: { token: string; password: string; name?: string }) {
      const json = await parse<{ data: { user: S[keyof S]; accessToken: string; refreshToken: string; expiresIn: number } }>(
        await request("/api/v1/auth/accept-invite", { method: "POST", body: JSON.stringify(body) }),
      );
      await options.setTokens?.(json.data);
      return json.data;
    },
    async invite(body: { email: string; role?: string; name?: string }) {
      const json = await parse<{ data: { user: S[keyof S]; email: string; role: string } }>(
        await request("/api/v1/auth/invites", { method: "POST", body: JSON.stringify(body) }),
      );
      return json.data;
    },
    async resendVerification(body: { userId?: string; email?: string } = {}) {
      const json = await parse<{ data: { ok: boolean } }>(
        await request("/api/v1/auth/resend-verification", { method: "POST", body: JSON.stringify(body) }),
      );
      return json.data;
    },
    files: {
      /** Uploads a file (signed in users only). Use uploadFile from @bakorin/sdk/headless for progress. */
      async upload(file: Blob, filename?: string): Promise<UploadedFile> {
        const form = new FormData();
        form.set("file", file, filename ?? (file as File).name ?? "upload");
        const json = await parse<{ data: UploadedFile }>(await request("/api/v1/files", { method: "POST", body: form }));
        return { ...json.data, url: fileUrl(json.data.url) };
      },
      /** A fresh signed link for a file you uploaded (admins: any file). */
      async sign(id: string): Promise<{ url: string; expiresAt: number }> {
        const json = await parse<{ data: { url: string; expiresAt: number } }>(
          await request(`/api/v1/files/${encodeURIComponent(id)}/sign`, { method: "POST" }),
        );
        return { ...json.data, url: fileUrl(json.data.url) };
      },
    },
    /** The resolved API root, for example https://site.example/api/bakorin. Signed file links are relative to it. */
    apiUrl(path = ""): string {
      return url(`/api/v1${path}`);
    },
    entity<K extends keyof S & string>(name: K) {
      return {
        async list(query?: Query) {
          return parse<ListResult<S[K]>>(await request(`/api/v1/${name}${queryString(query)}`));
        },
        async get(id: string, expand?: string) {
          const json = await parse<{ data: S[K] }>(await request(`/api/v1/${name}/${id}${expand ? `?expand=${expand}` : ""}`));
          return json.data;
        },
        async create(body: Partial<S[K]>) {
          const json = await parse<{ data: S[K] }>(await request(`/api/v1/${name}`, { method: "POST", body: JSON.stringify(body) }));
          return json.data;
        },
        async update(id: string, body: Partial<S[K]>) {
          const json = await parse<{ data: S[K] }>(
            await request(`/api/v1/${name}/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
          );
          return json.data;
        },
        async delete(id: string) {
          await parse(await request(`/api/v1/${name}/${id}`, { method: "DELETE" }));
        },
      };
    },
  };
}

export type BakorinClient<S extends object = Entities> = ReturnType<typeof createClient<S>>;

interface Listener {
  handler: (change: RealtimeChange) => void;
  options: SubscribeOptions;
}

interface SseFrame {
  id?: string;
  event: string;
  data: string;
  retry?: number;
}

/** Parses a server sent events body. Calls onFrame for each complete event. */
export async function readEventStream(body: ReadableStream<Uint8Array>, onFrame: (frame: SseFrame) => void): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n?/g, "\n");
      let index: number;
      while ((index = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        const frame: SseFrame = { event: "message", data: "" };
        let any = false;
        for (const line of block.split("\n")) {
          if (!line || line.startsWith(":")) continue;
          const colon = line.indexOf(":");
          const field = colon < 0 ? line : line.slice(0, colon);
          const value = colon < 0 ? "" : line.slice(colon + 1).replace(/^ /, "");
          any = true;
          if (field === "id") frame.id = value;
          else if (field === "event") frame.event = value;
          else if (field === "data") frame.data += (frame.data ? "\n" : "") + value;
          else if (field === "retry" && /^\d+$/.test(value)) frame.retry = Number(value);
        }
        if (any) onFrame(frame);
      }
    }
  } finally {
    reader.releaseLock();
  }
}

class StreamError extends Error {
  constructor(
    message: string,
    readonly retry: boolean,
  ) {
    super(message);
  }
}

/**
 * One multiplexed stream for every subscription on a client: changing the set of
 * entities reconnects once with the union, resuming from the last event id.
 */
function createRealtimeConnection(deps: {
  open: (entities: string[], lastEventId: string | undefined, signal: AbortSignal) => Promise<Response>;
  refresh: (() => Promise<string | null>) | null;
}) {
  const listeners = new Map<string, Set<Listener>>();
  let lastEventId: string | undefined;
  let generation = 0;
  let controller: AbortController | null = null;
  let restartTimer: ReturnType<typeof setTimeout> | null = null;
  let status: RealtimeStatus = "closed";

  const allListeners = () => [...listeners.values()].flatMap((set) => [...set]);
  const setStatus = (next: RealtimeStatus) => {
    if (next === status) return;
    status = next;
    for (const listener of allListeners()) listener.options.onStatus?.(next);
  };
  const sleep = (ms: number, signal: AbortSignal) =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, ms);
      signal.addEventListener("abort", () => {
        clearTimeout(timer);
        resolve();
      });
    });

  async function run(gen: number, signal: AbortSignal) {
    let attempt = 0;
    let refreshed = false;
    while (gen === generation && !signal.aborted) {
      const entities = [...listeners.keys()].sort();
      if (entities.length === 0) return;
      setStatus(attempt === 0 ? "connecting" : "reconnecting");
      let waitMs = Math.min(30_000, 500 * 2 ** attempt) * (0.5 + Math.random() * 0.5);
      try {
        const response = await deps.open(entities, lastEventId, signal);
        if (response.status === 401 && deps.refresh && !refreshed) {
          refreshed = true;
          await response.body?.cancel().catch(() => undefined);
          if (await deps.refresh()) continue;
        }
        if (response.status === 400 || response.status === 401 || response.status === 403 || response.status === 404) {
          const json = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
          throw new StreamError(json.error?.message ?? `realtime refused (${response.status})`, false);
        }
        if (!response.ok || !response.body) {
          const after = Number(response.headers.get("retry-after"));
          if (Number.isFinite(after) && after > 0) waitMs = after * 1000 * (1 + Math.random());
          await response.body?.cancel().catch(() => undefined);
          throw new StreamError(`realtime unavailable (${response.status})`, true);
        }
        let serverRetry: number | undefined;
        await readEventStream(response.body, (frame) => {
          if (frame.retry !== undefined) serverRetry = frame.retry;
          if (frame.id) lastEventId = frame.id;
          if (frame.event === "ready") {
            attempt = 0;
            refreshed = false;
            setStatus("open");
          } else if (frame.event === "change") {
            const data = JSON.parse(frame.data) as Omit<RealtimeChange, "eventId">;
            const change: RealtimeChange = { ...data, eventId: frame.id ?? "" };
            for (const listener of [...(listeners.get(change.entity) ?? [])]) {
              try {
                listener.handler(change);
              } catch (error) {
                console.error("[bakorin] realtime handler failed", error);
              }
            }
          } else if (frame.event === "reset") {
            for (const listener of allListeners()) listener.options.onReset?.();
          }
        });
        // The server ended the stream (restart, token expiry) or the network dropped it.
        if (serverRetry !== undefined) waitMs = serverRetry;
        attempt += 1;
      } catch (error) {
        if (signal.aborted || gen !== generation) return;
        if (error instanceof StreamError && !error.retry) {
          for (const listener of allListeners()) listener.options.onError?.(error);
          setStatus("closed");
          return;
        }
        attempt += 1;
      }
      if (gen !== generation || signal.aborted) return;
      setStatus("reconnecting");
      await sleep(waitMs, signal);
    }
  }

  function restart(resetPosition = false) {
    if (restartTimer) clearTimeout(restartTimer);
    restartTimer = setTimeout(() => {
      restartTimer = null;
      generation += 1;
      controller?.abort();
      controller = null;
      if (resetPosition) lastEventId = undefined;
      if (listeners.size === 0) {
        setStatus("closed");
        return;
      }
      const next = new AbortController();
      controller = next;
      void run(generation, next.signal);
    }, 10);
  }

  return {
    add(entity: string, handler: (change: RealtimeChange) => void, options: SubscribeOptions) {
      const listener: Listener = { handler, options };
      let set = listeners.get(entity);
      const isNewEntity = !set;
      if (!set) listeners.set(entity, (set = new Set()));
      set.add(listener);
      if (isNewEntity || !controller) restart();
      return () => {
        const current = listeners.get(entity);
        if (!current?.delete(listener)) return;
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
    },
  };
}
