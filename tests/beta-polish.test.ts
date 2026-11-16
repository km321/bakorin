// Update 6 (beta-polish): visitor IP through the site pass through route (N1),
// the refresh cookie path and session routes (N3), and the generic error when
// Bakorin is unreachable (N4). Upstream runs over a real socket, so Bakorin sees
// one address for every visitor, exactly like a deployed site.
import { afterEach, describe, expect, test } from "bun:test";
import { createAstroProxy } from "@bakorin/sdk/astro";
import { createNextProxy } from "@bakorin/sdk/next";
import { createProxyHandler, rightmostForwardedFor } from "@bakorin/sdk/astro";
import { visitorHeaders } from "@bakorin/sdk";
import { resetRateLimit } from "@bakorin/server";
import { boot, MINI_YAML } from "./helpers.ts";

const SECRET = "test-proxy-secret-0123456789-abcdefghij";
const SITE = "http://site.test";
const JSON_HEADERS = { "content-type": "application/json" };

const YAML = MINI_YAML.replace(
  "entities:\n",
  `entities:
  notes:
    realtime: true
    fields:
      body: { type: text, required: true }
    policies:
      read: public
      create: authenticated
      update: admin
      delete: admin
`,
);

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

type Runtime = Awaited<ReturnType<typeof boot>>;

async function started(env: Record<string, string> = {}) {
  resetRateLimit();
  const saved: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env)) {
    saved[key] = process.env[key];
    process.env[key] = value;
  }
  try {
    const runtime = await boot(YAML);
    cleanups.push(() => runtime.close());
    return runtime;
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

/** Serves the runtime on a socket and returns its URL. */
function serve(runtime: Runtime): string {
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", idleTimeout: 0, fetch: (request, srv) => runtime.app.fetch(request, srv) });
  cleanups.push(() => server.stop(true));
  return `http://127.0.0.1:${server.port}`;
}

type AstroRoute = (context: { request: Request; clientAddress?: string }) => Promise<Response>;

/** One visitor of the site: a cookie jar and an address. */
function visitor(route: AstroRoute, clientAddress: string) {
  const jar = new Map<string, string>();
  const send = async (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    if (jar.size) headers.set("cookie", [...jar].map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("; "));
    if ((init.method ?? "GET").toUpperCase() !== "GET") headers.set("origin", SITE);
    const response = await route({ request: new Request(`${SITE}${path}`, { ...init, headers }), clientAddress });
    for (const line of response.headers.getSetCookie()) {
      const [pair] = line.split(";");
      const index = pair!.indexOf("=");
      const name = pair!.slice(0, index);
      if (/Max-Age=0/.test(line)) jar.delete(name);
      else jar.set(name, decodeURIComponent(pair!.slice(index + 1)));
    }
    return response;
  };
  return { jar, send };
}

async function signup(runtime: Runtime, email: string) {
  await runtime.app.request("/api/v1/auth/signup", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ email, password: "password123", name: "Pat" }),
  });
}

const login = (password: string, email = "victim@example.test") => ({
  method: "POST",
  headers: JSON_HEADERS,
  body: JSON.stringify({ email, password }),
});

describe("N1 visitor IP through the site route", () => {
  test("one visitor's failed logins do not lock the account for other visitors", async () => {
    const runtime = await started({ BAKORIN_PROXY_SECRET: SECRET });
    await signup(runtime, "victim@example.test");
    const route = createAstroProxy({ baseUrl: serve(runtime), proxySecret: SECRET }) as AstroRoute;
    const attacker = visitor(route, "203.0.113.7");
    const owner = visitor(route, "198.51.100.20");
    const attempts: number[] = [];
    for (let i = 0; i < 6; i++) attempts.push((await attacker.send("/api/bakorin/auth/login", login(`wrong-${i}`))).status);
    expect(attempts.slice(0, 4)).toEqual([401, 401, 401, 401]);
    expect(attempts.at(-1)).toBe(429);
    // The attacker is locked, the owner is not.
    expect((await attacker.send("/api/bakorin/auth/login", login("password123"))).status).toBe(429);
    expect((await owner.send("/api/bakorin/auth/login", login("password123"))).status).toBe(200);
    expect(owner.jar.has("bakorin_access")).toBe(true);
  });

  test("the anonymous realtime cap applies per visitor", async () => {
    const runtime = await started({ BAKORIN_PROXY_SECRET: SECRET });
    const route = createAstroProxy({ baseUrl: serve(runtime), proxySecret: SECRET }) as AstroRoute;
    const aborts: AbortController[] = [];
    cleanups.push(() => aborts.forEach((ac) => ac.abort()));
    const open = async (address: string) => {
      const ac = new AbortController();
      aborts.push(ac);
      const response = await route({ request: new Request(`${SITE}/api/bakorin/realtime?entities=notes`, { signal: ac.signal }), clientAddress: address });
      return response.status;
    };
    // 25 different visitors all get a stream.
    const many: number[] = [];
    for (let i = 0; i < 25; i++) many.push(await open(`192.0.2.${i + 1}`));
    expect(many.every((status) => status === 200)).toBe(true);
    // One visitor still stops at the per visitor cap (20).
    const one: number[] = [];
    for (let i = 0; i < 21; i++) one.push(await open("198.51.100.99"));
    expect(one.slice(0, 20).every((status) => status === 200)).toBe(true);
    expect(one[20]).toBe(429);
  });

  test("without the shared secret the visitor header is ignored", async () => {
    const runtime = await started({ BAKORIN_PROXY_SECRET: SECRET });
    await signup(runtime, "victim@example.test");
    const base = serve(runtime);
    // A caller that names its own IP with a wrong secret stays on its socket address.
    for (let i = 0; i < 5; i++) {
      await fetch(`${base}/api/v1/auth/login`, {
        ...login(`wrong-${i}`),
        headers: { ...JSON_HEADERS, ...visitorHeaders(`203.0.113.${i + 1}`, "not-the-secret-not-the-secret-not-the") },
      });
    }
    const locked = await fetch(`${base}/api/v1/auth/login`, {
      ...login("password123"),
      headers: { ...JSON_HEADERS, ...visitorHeaders("203.0.113.200", "not-the-secret-not-the-secret-not-the") },
    });
    expect(locked.status).toBe(429);
    // A site with the right secret names a different visitor, who is not locked.
    const fine = await fetch(`${base}/api/v1/auth/login`, {
      ...login("password123"),
      headers: { ...JSON_HEADERS, ...visitorHeaders("203.0.113.200", SECRET) },
    });
    expect(fine.status).toBe(200);
  });

  test("a server without BAKORIN_PROXY_SECRET never trusts the header", async () => {
    const runtime = await started();
    await signup(runtime, "victim@example.test");
    const base = serve(runtime);
    for (let i = 0; i < 5; i++) {
      await fetch(`${base}/api/v1/auth/login`, { ...login(`wrong-${i}`), headers: { ...JSON_HEADERS, ...visitorHeaders(`203.0.113.${i}`, SECRET) } });
    }
    const response = await fetch(`${base}/api/v1/auth/login`, { ...login("password123"), headers: { ...JSON_HEADERS, ...visitorHeaders("203.0.113.250", SECRET) } });
    expect(response.status).toBe(429);
  });

  test("the Next route reads the right end of X-Forwarded-For", async () => {
    expect(rightmostForwardedFor(new Request(SITE, { headers: { "x-forwarded-for": "1.1.1.1, 203.0.113.9" } }))).toBe("203.0.113.9");
    expect(rightmostForwardedFor(new Headers({ "x-real-ip": "198.51.100.1" }))).toBe("198.51.100.1");
    expect(rightmostForwardedFor(new Headers())).toBeUndefined();
    const seen: Array<string | null> = [];
    const route = createNextProxy({
      baseUrl: "http://bakorin.internal",
      proxySecret: SECRET,
      fetch: (_input, init) => {
        seen.push(new Headers(init.headers).get("x-bakorin-client-ip"));
        return Promise.resolve(new Response("{}", { headers: JSON_HEADERS }));
      },
    });
    await route.GET(new Request(`${SITE}/api/bakorin/notes`, { headers: { "x-forwarded-for": "10.0.0.1, 203.0.113.9" } }));
    expect(seen).toEqual(["203.0.113.9"]);
  });
});

describe("N3 refresh cookie path and session routes", () => {
  test("the refresh cookie only goes to the route, and pages renew through /-/refresh", async () => {
    const runtime = await started({ BAKORIN_PROXY_SECRET: SECRET });
    await signup(runtime, "pat@example.test");
    const route = createAstroProxy({ baseUrl: serve(runtime), proxySecret: SECRET }) as AstroRoute;
    const pat = visitor(route, "198.51.100.5");
    const response = await pat.send("/api/bakorin/auth/login", login("password123", "pat@example.test"));
    expect(response.status).toBe(200);
    const cookies = response.headers.getSetCookie();
    expect(cookies.some((line) => line.startsWith("bakorin_refresh=") && line.includes("Path=/api/bakorin;") && !line.includes("Max-Age=0"))).toBe(true);
    expect(cookies.some((line) => line.startsWith("bakorin_access=") && line.includes("Path=/;"))).toBe(true);
    // An older Path=/ refresh cookie is cleared.
    expect(cookies.some((line) => line.startsWith("bakorin_refresh=;") && line.includes("Path=/;") && line.includes("Max-Age=0"))).toBe(true);

    const oldRefresh = pat.jar.get("bakorin_refresh");
    pat.jar.delete("bakorin_access");
    const renew = await pat.send("/api/bakorin/-/refresh?next=%2Fapp%3Ftab%3D1&fail=/login");
    expect(renew.status).toBe(303);
    expect(renew.headers.get("location")).toBe("/app?tab=1");
    expect(pat.jar.get("bakorin_access")).toBeTruthy();
    expect(pat.jar.get("bakorin_refresh")).not.toBe(oldRefresh);

    // Only same site paths are followed.
    for (const next of ["//evil.example/x", "https://evil.example", "/\\evil.example"]) {
      const bounced = await pat.send(`/api/bakorin/-/refresh?next=${encodeURIComponent(next)}`);
      expect(bounced.headers.get("location")).toBe("/");
    }
    // No refresh cookie: straight to the fail page.
    const stranger = visitor(route, "198.51.100.6");
    const none = await stranger.send("/api/bakorin/-/refresh?next=/app&fail=/login");
    expect(none.headers.get("location")).toBe("/login");
  });

  test("/-/logout revokes the session and clears cookies; cross-site links are ignored", async () => {
    const runtime = await started({ BAKORIN_PROXY_SECRET: SECRET });
    await signup(runtime, "pat@example.test");
    const base = serve(runtime);
    const route = createAstroProxy({ baseUrl: base, proxySecret: SECRET }) as AstroRoute;
    const pat = visitor(route, "198.51.100.5");
    await pat.send("/api/bakorin/auth/login", login("password123", "pat@example.test"));
    const refresh = pat.jar.get("bakorin_refresh")!;

    const cross = await pat.send("/api/bakorin/-/logout?next=/", { headers: { "sec-fetch-site": "cross-site" } });
    expect(cross.status).toBe(303);
    expect(pat.jar.has("bakorin_refresh")).toBe(true);

    const out = await pat.send("/api/bakorin/-/logout?next=/", { headers: { "sec-fetch-site": "same-origin" } });
    expect(out.status).toBe(303);
    expect(out.headers.get("location")).toBe("/");
    expect(pat.jar.has("bakorin_refresh")).toBe(false);
    expect(pat.jar.has("bakorin_access")).toBe(false);
    const reuse = await fetch(`${base}/api/v1/auth/refresh`, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ refreshToken: refresh }) });
    expect(reuse.status).toBe(401);
  });
});

describe("N4 unreachable Bakorin", () => {
  test("visitors get a generic message and the detail goes to the server log", async () => {
    const logged: unknown[] = [];
    const route = createProxyHandler({
      baseUrl: "http://10.9.8.7:4371",
      fetch: () => Promise.reject(new Error("connect ECONNREFUSED 10.9.8.7:4371")),
      onError: (error) => logged.push(error),
    });
    const response = await route(new Request(`${SITE}/api/bakorin/notes`));
    expect(response.status).toBe(502);
    const text = await response.text();
    expect(text).not.toContain("10.9.8.7");
    expect(text).not.toContain("ECONNREFUSED");
    expect(JSON.parse(text).error.code).toBe("upstream_unavailable");
    expect(String(logged[0])).toContain("ECONNREFUSED");
  });
});
