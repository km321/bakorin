// src/index.ts
function createClient(options) {
  const fetcher = options.fetch ?? fetch;
  let refreshMutex = null;
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
      const response = await fetcher(new URL("/api/v1/auth/refresh", options.baseUrl), {
        method: "POST",
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
    const response = await fetcher(new URL(path, options.baseUrl), { ...init, headers });
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
  return {
    async signup(body) {
      const json = await parse(await request("/api/v1/auth/signup", { method: "POST", body: JSON.stringify(body) }));
      if (json.data.accessToken && json.data.refreshToken && json.data.expiresIn !== undefined) {
        await options.setTokens?.({
          accessToken: json.data.accessToken,
          refreshToken: json.data.refreshToken,
          expiresIn: json.data.expiresIn
        });
      }
      return json.data;
    },
    async login(body) {
      const json = await parse(await request("/api/v1/auth/login", { method: "POST", body: JSON.stringify(body) }));
      await options.setTokens?.(json.data);
      return json.data;
    },
    async logout(refreshToken) {
      await request("/api/v1/auth/logout", { method: "POST", body: JSON.stringify({ refreshToken }) });
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
export {
  createNextClient
};
