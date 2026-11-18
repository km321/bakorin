import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { compileAppYaml, deserializeAst, SchemaError, serializeAst } from "@bakorin/core";
import {
  accessTokenExpiresAt,
  getAccessToken,
  getMe,
  getMeta,
  hasToken,
  resetRefreshMutexForTests,
  signOut,
  uploadFile,
} from "../packages/admin-ui/src/lib/api.ts";
import { createIdleController, idleTimeoutMs, warningLeadMs } from "../packages/admin-ui/src/lib/idle.ts";
import {
  LAST_ACTIVITY_KEY,
  REFRESH_KEY,
  TOKEN_KEY,
  consumeSessionNotice,
  resetSessionChannelForTests,
  sessionNoticeMessage,
} from "../packages/admin-ui/src/lib/session.ts";
import { boot, client, MINI_YAML } from "./helpers.ts";

const JWT = "test-jwt-secret-0123456789-abcdefghijklmnop";

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key: string) {
      return map.has(key) ? map.get(key)! : null;
    },
    key(index: number) {
      return [...map.keys()][index] ?? null;
    },
    removeItem(key: string) {
      map.delete(key);
    },
    setItem(key: string, value: string) {
      map.set(String(key), String(value));
    },
  } as Storage;
}

function jwtWithExp(expSeconds: number): string {
  const encode = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none", typ: "JWT" })}.${encode({ exp: expSeconds })}.sig`;
}

function installStorage(): { local: Storage; session: Storage } {
  const local = memoryStorage();
  const session = memoryStorage();
  Object.defineProperty(globalThis, "localStorage", { value: local, configurable: true });
  Object.defineProperty(globalThis, "sessionStorage", { value: session, configurable: true });
  return { local, session };
}

function sessionYaml(extraRuntime = ""): string {
  return MINI_YAML.replace(
    "    secret: test-jwt-secret-0123456789-abcdefghijklmnop\n",
    `    secret: test-jwt-secret-0123456789-abcdefghijklmnop\n${extraRuntime}`,
  );
}

describe("runtime.admin.idleTimeoutMinutes", () => {
  test("defaults to off", () => {
    const ast = compileAppYaml(MINI_YAML, { env: { JWT_SECRET: JWT } });
    expect(ast.runtime.adminIdleTimeoutMinutes).toBeNull();
  });

  test("parses a valid timeout", () => {
    const ast = compileAppYaml(sessionYaml("  admin:\n    idleTimeoutMinutes: 30\n"), { env: { JWT_SECRET: JWT } });
    expect(ast.runtime.adminIdleTimeoutMinutes).toBe(30);
  });

  test("rejects zero, fractions, and values over 7 days", () => {
    expect(() => compileAppYaml(sessionYaml("  admin:\n    idleTimeoutMinutes: 0\n"), { env: { JWT_SECRET: JWT } })).toThrow(SchemaError);
    expect(() => compileAppYaml(sessionYaml("  admin:\n    idleTimeoutMinutes: 30.5\n"), { env: { JWT_SECRET: JWT } })).toThrow(SchemaError);
    expect(() => compileAppYaml(sessionYaml("  admin:\n    idleTimeoutMinutes: 10081\n"), { env: { JWT_SECRET: JWT } })).toThrow(SchemaError);
  });

  test("deserializes older ASTs without the field as off", () => {
    const ast = compileAppYaml(MINI_YAML, { env: { JWT_SECRET: JWT } });
    const raw = JSON.parse(serializeAst(ast)) as { runtime: { adminIdleTimeoutMinutes?: number | null } };
    delete raw.runtime.adminIdleTimeoutMinutes;
    const restored = deserializeAst(JSON.stringify(raw));
    expect(restored.runtime.adminIdleTimeoutMinutes).toBeNull();
  });

  test("GET /api/v1/_meta exposes the setting", async () => {
    const runtime = await boot(sessionYaml("  admin:\n    idleTimeoutMinutes: 45\n"));
    const http = client(runtime);
    const first = await http.fetch("/api/v1/auth/first-admin", {
      method: "POST",
      body: JSON.stringify({ email: "ada@studio.test", password: "password123", name: "Ada" }),
    });
    const token = ((await first.json()) as { data: { accessToken: string } }).data.accessToken;
    const meta = await http.fetch("/api/v1/_meta", { headers: { authorization: `Bearer ${token}` } });
    const body = (await meta.json()) as { data: { admin: { idleTimeoutMinutes: number | null } } };
    expect(body.data.admin.idleTimeoutMinutes).toBe(45);
    await runtime.close();
  });

  test("GET /api/v1/_meta sends null when the timeout is off", async () => {
    const runtime = await boot();
    const http = client(runtime);
    const first = await http.fetch("/api/v1/auth/first-admin", {
      method: "POST",
      body: JSON.stringify({ email: "ada@studio.test", password: "password123", name: "Ada" }),
    });
    const token = ((await first.json()) as { data: { accessToken: string } }).data.accessToken;
    const meta = await http.fetch("/api/v1/_meta", { headers: { authorization: `Bearer ${token}` } });
    const body = (await meta.json()) as { data: { admin: { idleTimeoutMinutes: number | null } } };
    expect(body.data.admin.idleTimeoutMinutes).toBeNull();
    await runtime.close();
  });
});

describe("idle timer", () => {
  beforeEach(() => {
    installStorage();
  });

  test("idleTimeoutMs and warningLeadMs helpers", () => {
    expect(idleTimeoutMs(null)).toBeNull();
    expect(idleTimeoutMs(undefined)).toBeNull();
    expect(idleTimeoutMs(0)).toBeNull();
    expect(idleTimeoutMs(30)).toBe(30 * 60_000);
    expect(warningLeadMs(30 * 60_000)).toBe(60_000);
    expect(warningLeadMs(30_000)).toBeNull();
  });

  test("warns about 1 minute before, then signs out, and activity cancels the warning", () => {
    let now = 1_000;
    const events: string[] = [];
    const controller = createIdleController({
      timeoutMs: 5_000,
      warningMs: 1_000,
      now: () => now,
      attachListeners: false,
      setInterval: () => 1,
      clearInterval: () => undefined,
      onWarning: () => events.push("warn"),
      onWarningCancel: () => events.push("cancel"),
      onIdle: () => events.push("idle"),
    });
    controller.start();
    expect(controller.lastActivityAt()).toBe(1_000);
    now = 4_000;
    controller.tick();
    expect(events).toEqual([]);
    now = 5_000;
    controller.tick();
    expect(events).toEqual(["warn"]);
    now = 5_500;
    controller.recordActivity();
    expect(events).toEqual(["warn", "cancel"]);
    now = 9_000;
    controller.tick();
    expect(events).toEqual(["warn", "cancel"]);
    now = 10_000;
    controller.tick();
    expect(events).toEqual(["warn", "cancel", "warn"]);
    now = 10_500;
    controller.tick();
    expect(events).toEqual(["warn", "cancel", "warn", "idle"]);
  });

  test("skips the warning when the timeout is one minute or less", () => {
    let now = 0;
    const events: string[] = [];
    const controller = createIdleController({
      timeoutMs: 60_000,
      warningMs: 60_000,
      now: () => now,
      attachListeners: false,
      setInterval: () => 1,
      clearInterval: () => undefined,
      onWarning: () => events.push("warn"),
      onIdle: () => events.push("idle"),
    });
    controller.start();
    now = 59_000;
    controller.tick();
    expect(events).toEqual([]);
    now = 60_000;
    controller.tick();
    expect(events).toEqual(["idle"]);
  });

  test("activity in another tab (storage) keeps this tab alive", () => {
    let now = 0;
    const events: string[] = [];
    const controller = createIdleController({
      timeoutMs: 5_000,
      warningMs: 1_000,
      now: () => now,
      attachListeners: false,
      setInterval: () => 1,
      clearInterval: () => undefined,
      onWarning: () => events.push("warn"),
      onWarningCancel: () => events.push("cancel"),
      onIdle: () => events.push("idle"),
    });
    controller.start();
    now = 4_000;
    controller.tick();
    expect(events).toEqual(["warn"]);
    localStorage.setItem(LAST_ACTIVITY_KEY, "4000");
    controller.syncFromStorage();
    expect(events).toEqual(["warn", "cancel"]);
    now = 8_000;
    controller.tick();
    expect(events).toEqual(["warn", "cancel", "warn"]);
    now = 9_000;
    controller.tick();
    expect(events).toEqual(["warn", "cancel", "warn", "idle"]);
  });
});

describe("admin token refresh", () => {
  const realFetch = globalThis.fetch;
  let restoreFetch: (() => void) | undefined;

  beforeEach(() => {
    installStorage();
    resetRefreshMutexForTests();
    resetSessionChannelForTests();
  });

  afterEach(() => {
    restoreFetch?.();
    restoreFetch = undefined;
    globalThis.fetch = realFetch;
    resetRefreshMutexForTests();
    resetSessionChannelForTests();
  });

  function stubRelativeFetch(base: string, onCall?: (url: string, init?: RequestInit) => void) {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const raw = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      onCall?.(raw, init);
      const url = raw.startsWith("/") ? `${base}${raw}` : raw;
      return realFetch(url, init);
    }) as typeof fetch;
    restoreFetch = () => {
      globalThis.fetch = realFetch;
    };
  }

  test("accessTokenExpiresAt reads the JWT exp claim", () => {
    expect(accessTokenExpiresAt(jwtWithExp(1_700_000_000))).toBe(1_700_000_000_000);
    expect(accessTokenExpiresAt("not-a-jwt")).toBeNull();
  });

  test("concurrent requests share one refresh and retry once", async () => {
    const runtime = await boot(sessionYaml("    accessTtlSeconds: 2\n"));
    const http = client(runtime);
    const created = await http.fetch("/api/v1/auth/first-admin", {
      method: "POST",
      body: JSON.stringify({ email: "ada@studio.test", password: "password123", name: "Ada" }),
    });
    const session = (await created.json()) as { data: { accessToken: string; refreshToken: string } };
    localStorage.setItem(TOKEN_KEY, session.data.accessToken);
    localStorage.setItem(REFRESH_KEY, session.data.refreshToken);
    const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: (request) => runtime.app.fetch(request) });
    const calls: string[] = [];
    stubRelativeFetch(`http://127.0.0.1:${server.port}`, (url) => calls.push(url));
    try {
      await Bun.sleep(2_400);
      const [meA, meB, meta] = await Promise.all([getMe(), getMe(), getMeta()]);
      expect(meA.email).toBe("ada@studio.test");
      expect(meB.email).toBe("ada@studio.test");
      expect(meta.app.name).toBe("mini");
      expect(calls.filter((url) => url === "/api/v1/auth/refresh")).toHaveLength(1);
      expect(localStorage.getItem(TOKEN_KEY)).not.toBe(session.data.accessToken);
      expect(localStorage.getItem(REFRESH_KEY)).not.toBe(session.data.refreshToken);
      expect(hasToken()).toBe(true);
    } finally {
      server.stop(true);
      await runtime.close();
    }
  });

  test("a 401 triggers refresh and retries the original request, including file uploads", async () => {
    const runtime = await boot();
    const http = client(runtime);
    const created = await http.fetch("/api/v1/auth/first-admin", {
      method: "POST",
      body: JSON.stringify({ email: "ada@studio.test", password: "password123", name: "Ada" }),
    });
    const session = (await created.json()) as { data: { accessToken: string; refreshToken: string } };
    // Store a token the server will reject, plus a live refresh token.
    localStorage.setItem(TOKEN_KEY, jwtWithExp(Math.floor(Date.now() / 1000) + 3_600));
    localStorage.setItem(REFRESH_KEY, session.data.refreshToken);
    const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: (request) => runtime.app.fetch(request) });
    const calls: Array<{ url: string; status?: number }> = [];
    const inner = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const raw = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const url = raw.startsWith("/") ? `http://127.0.0.1:${server.port}${raw}` : raw;
      const response = await realFetch(url, init);
      calls.push({ url: raw, status: response.status });
      return response;
    }) as typeof fetch;
    restoreFetch = () => {
      globalThis.fetch = inner;
    };
    try {
      const file = new File(["hello"], "note.txt", { type: "text/plain" });
      const uploaded = await uploadFile(file);
      expect(uploaded.filename).toBe("note.txt");
      expect(calls.some((item) => item.url === "/api/v1/auth/refresh" && item.status === 200)).toBe(true);
      expect(calls.filter((item) => item.url === "/api/v1/files")).toHaveLength(2);
      expect(calls.find((item) => item.url === "/api/v1/files")?.status).toBe(401);
      expect(localStorage.getItem(TOKEN_KEY)).not.toBe(jwtWithExp(Math.floor(Date.now() / 1000) + 3_600));
    } finally {
      server.stop(true);
      await runtime.close();
    }
  });

  test("a failed refresh signs out, revokes nothing further, and sets the session expired notice", async () => {
    const refreshCalls: string[] = [];
    let logoutCalls = 0;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const raw = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (raw === "/api/v1/auth/refresh") {
        refreshCalls.push(JSON.parse(String(init?.body)).refreshToken);
        return new Response(JSON.stringify({ error: { message: "invalid refresh token" } }), { status: 401 });
      }
      if (raw === "/api/v1/auth/logout") {
        logoutCalls += 1;
        return new Response(JSON.stringify({ data: { ok: true } }), { status: 200 });
      }
      if (raw.startsWith("/api/v1/auth/me") || raw.startsWith("/api/v1/_meta")) {
        return new Response(JSON.stringify({ error: { message: "sign in required" } }), { status: 401 });
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;
    restoreFetch = () => {
      globalThis.fetch = realFetch;
    };
    localStorage.setItem(TOKEN_KEY, jwtWithExp(Math.floor(Date.now() / 1000) - 10));
    localStorage.setItem(REFRESH_KEY, "stale-refresh");
    try {
      await expect(getMe()).rejects.toThrow();
      expect(refreshCalls).toEqual(["stale-refresh"]);
      expect(logoutCalls).toBe(1);
      expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
      expect(localStorage.getItem(REFRESH_KEY)).toBeNull();
      expect(consumeSessionNotice()).toBe("expired");
      expect(sessionNoticeMessage("expired")).toBe("Your session expired. Sign in again.");
    } finally {
      // storage and fetch are reset in afterEach
    }
  });

  test("signOut posts to /logout and does not try to refresh", async () => {
    const paths: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const raw = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      paths.push(raw);
      return new Response(JSON.stringify({ data: { ok: true } }), { status: 200 });
    }) as typeof fetch;
    restoreFetch = () => {
      globalThis.fetch = realFetch;
    };
    localStorage.setItem(TOKEN_KEY, "access");
    localStorage.setItem(REFRESH_KEY, "refresh-1");
    await signOut();
    expect(paths).toEqual(["/api/v1/auth/logout"]);
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(localStorage.getItem(REFRESH_KEY)).toBeNull();
  });

  test("getAccessToken returns a fresh token without waiting for a 401", async () => {
    const runtime = await boot(sessionYaml("    accessTtlSeconds: 2\n"));
    const http = client(runtime);
    const created = await http.fetch("/api/v1/auth/first-admin", {
      method: "POST",
      body: JSON.stringify({ email: "ada@studio.test", password: "password123", name: "Ada" }),
    });
    const session = (await created.json()) as { data: { accessToken: string; refreshToken: string } };
    localStorage.setItem(TOKEN_KEY, session.data.accessToken);
    localStorage.setItem(REFRESH_KEY, session.data.refreshToken);
    const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: (request) => runtime.app.fetch(request) });
    stubRelativeFetch(`http://127.0.0.1:${server.port}`);
    try {
      await Bun.sleep(2_400);
      const token = await getAccessToken();
      expect(token).toBeTruthy();
      expect(token).not.toBe(session.data.accessToken);
      expect(hasToken()).toBe(true);
    } finally {
      server.stop(true);
      await runtime.close();
    }
  });
});
