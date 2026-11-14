export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface ListResult<T> {
  data: T[];
  meta: { total: number; limit: number; offset: number };
}

export interface ClientOptions {
  baseUrl: string;
  getAccessToken?: () => Promise<string | null> | string | null;
  getRefreshToken?: () => Promise<string | null> | string | null;
  setTokens?: (tokens: AuthTokens) => Promise<void> | void;
  fetch?: typeof fetch;
}

export interface Query {
  limit?: number;
  offset?: number;
  sort?: string;
  expand?: string;
  filter?: Record<string, string | number | boolean | { op: string; value: unknown }>;
}

type Entities = Record<string, Record<string, unknown>>;

export function createClient<S extends Entities = Entities>(options: ClientOptions) {
  const fetcher = options.fetch ?? fetch;
  let refreshMutex: Promise<string | null> | null = null;

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
      const response = await fetcher(new URL("/api/v1/auth/refresh", options.baseUrl), {
        method: "POST",
        headers: { "content-type": "application/json" },
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
    const headers = new Headers(init.headers);
    const access = await token();
    if (access) {
      headers.set("authorization", `Bearer ${access}`);
    }
    if (init.body && !headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }
    const response = await fetcher(new URL(path, options.baseUrl), { ...init, headers });
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
    const json = await response.json();
    if (!response.ok) {
      throw new Error(json.error?.message ?? `request failed (${response.status})`);
    }
    return json as T;
  }

  return {
    async signup(body: Record<string, unknown>) {
      const json = await parse<{ data: { user: S[string]; accessToken: string; refreshToken: string; expiresIn: number } }>(
        await request("/api/v1/auth/signup", { method: "POST", body: JSON.stringify(body) }),
      );
      await options.setTokens?.(json.data);
      return json.data;
    },
    async login(body: Record<string, unknown>) {
      const json = await parse<{ data: { user: S[string]; accessToken: string; refreshToken: string; expiresIn: number } }>(
        await request("/api/v1/auth/login", { method: "POST", body: JSON.stringify(body) }),
      );
      await options.setTokens?.(json.data);
      return json.data;
    },
    async logout(refreshToken?: string) {
      await request("/api/v1/auth/logout", { method: "POST", body: JSON.stringify({ refreshToken }) });
    },
    async me() {
      const json = await parse<{ data: S[string] }>(await request("/api/v1/auth/me"));
      return json.data;
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

export type BakorinClient<S extends Entities = Entities> = ReturnType<typeof createClient<S>>;
