// The browser pass through (createProxyHandler / createAstroProxy / createNextProxy),
// the browser client, and SDK subscribe(): shared stream, resume after a drop, and
// streaming through the proxy with httpOnly cookies.
import { afterEach, describe, expect, test } from "bun:test";
import { createClient, type RealtimeChange } from "@bakorin/sdk";
import { createAstroProxy, createProxyHandler } from "@bakorin/sdk/astro";
import { createNextProxy } from "@bakorin/sdk/next";
import { createBrowserClient } from "@bakorin/sdk/browser";
import { resetRateLimit } from "@bakorin/server";
import { boot, MINI_YAML } from "./helpers.ts";

const cleanups: Array<() => Promise<unknown> | unknown> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

const RT_YAML = MINI_YAML.replace(
  "      ownerId: { type: relation, to: users, required: true }\n    policies:",
  "      ownerId: { type: relation, to: users, required: true }\n    realtime: true\n    policies:",
).replace(
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

type Runtime = Awaited<ReturnType<typeof boot>>;

async function started(yaml = RT_YAML) {
  resetRateLimit();
  const runtime = await boot(yaml);
  cleanups.push(() => runtime.close());
  return runtime;
}

const SITE = "http://site.test";

/** Upstream fetch that serves the runtime in process. */
function upstream(runtime: Runtime) {
  return (input: string, init: RequestInit) => {
    const url = new URL(input);
    return Promise.resolve(runtime.app.request(`${url.pathname}${url.search}`, init));
  };
}

/** A tiny cookie jar, standing in for the browser. */
function browser(handler: (request: Request) => Promise<Response> | Response) {
  const jar = new Map<string, string>();
  const send = async (path: string, init: RequestInit & { origin?: string | null } = {}) => {
    const headers = new Headers(init.headers);
    if (jar.size) headers.set("cookie", [...jar].map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("; "));
    const method = (init.method ?? "GET").toUpperCase();
    if (init.origin !== null && method !== "GET") headers.set("origin", init.origin ?? SITE);
    const response = await handler(new Request(`${SITE}${path}`, { ...init, headers }));
    for (const line of response.headers.getSetCookie()) {
      const [pair] = line.split(";");
      const index = pair!.indexOf("=");
      const name = pair!.slice(0, index);
      const value = decodeURIComponent(pair!.slice(index + 1));
      if (/Max-Age=0/.test(line)) jar.delete(name);
      else jar.set(name, value);
    }
    return response;
  };
  return { jar, send };
}

async function user(runtime: Runtime, email: string) {
  const json = { "content-type": "application/json" };
  await runtime.app.request("/api/v1/auth/signup", { method: "POST", headers: json, body: JSON.stringify({ email, password: "password123", name: "Pat" }) });
  const res = await runtime.app.request("/api/v1/auth/login", { method: "POST", headers: json, body: JSON.stringify({ email, password: "password123" }) });
  const body = (await res.json()) as { data: { user: { id: string }; accessToken: string; refreshToken: string } };
  return { id: body.data.user.id, token: body.data.accessToken, refresh: body.data.refreshToken };
}

async function until(check: () => boolean, timeoutMs = 4000) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error("timed out");
    await Bun.sleep(10);
  }
}

describe("browser pass through route", () => {
  test("blocks cross-site writes, path tricks, and direct refresh calls", async () => {
    const runtime = await started();
    const proxy = createProxyHandler({ baseUrl: "http://bakorin.internal", fetch: upstream(runtime) });
    const site = browser(proxy);
    const cross = await site.send("/api/bakorin/notes", { method: "POST", body: "{}", origin: "https://evil.example" });
    expect(cross.status).toBe(403);
    expect(((await cross.json()) as { error: { code: string } }).error.code).toBe("csrf");
    // No Origin and no Sec-Fetch-Site: refused too.
    expect((await site.send("/api/bakorin/notes", { method: "POST", body: "{}", origin: null })).status).toBe(403);
    // Sec-Fetch-Site same-origin without Origin is fine (reaches Bakorin, which wants a login).
    const fetchSite = await site.send("/api/bakorin/notes", {
      method: "POST",
      body: JSON.stringify({ body: "x" }),
      origin: null,
      headers: { "sec-fetch-site": "same-origin", "content-type": "application/json" },
    });
    expect(fetchSite.status).toBe(401);
    expect((await site.send("/api/bakorin/items/..%2F..%2Fadmin")).status).toBe(400);
    // Plain dot segments are normalized by URL parsing and land outside the route.
    expect((await site.send("/api/bakorin/%2e%2e/admin")).status).toBe(404);
    expect((await site.send("/api/bakorin/auth/refresh", { method: "POST", body: "{}" })).status).toBe(404);
    expect((await site.send("/elsewhere")).status).toBe(404);
    // An allowlisted origin may write.
    const allowed = browser(createProxyHandler({ baseUrl: "http://x", fetch: upstream(runtime), allowedOrigins: ["https://preview.example"] }));
    expect((await allowed.send("/api/bakorin/notes", { method: "POST", body: "{}", origin: "https://preview.example" })).status).toBe(401);
  });

  test("login sets httpOnly cookies, hides tokens, refreshes once, and logout clears", async () => {
    const runtime = await started();
    await user(runtime, "pat@example.test");
    const site = browser(createProxyHandler({ baseUrl: "http://bakorin.internal", fetch: upstream(runtime) }));
    const login = await site.send("/api/bakorin/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "pat@example.test", password: "password123" }),
    });
    expect(login.status).toBe(200);
    const body = (await login.json()) as { data: Record<string, unknown> };
    expect(body.data.user).toBeTruthy();
    expect(body.data.accessToken).toBeUndefined();
    expect(body.data.refreshToken).toBeUndefined();
    const cookies = login.headers.getSetCookie();
    expect(cookies.some((line) => line.startsWith("bakorin_access=") && line.includes("HttpOnly") && line.includes("SameSite=Lax"))).toBe(true);
    expect(cookies.every((line) => !line.includes("Secure"))).toBe(true);

    const create = await site.send("/api/bakorin/items", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Water the ferns" }),
    });
    expect(create.status).toBe(201);
    expect(create.headers.get("cache-control")).toBe("no-store");

    // An expired or bad access cookie is refreshed once with the refresh cookie.
    const oldRefresh = site.jar.get("bakorin_refresh");
    site.jar.set("bakorin_access", "expired.token.value");
    const list = await site.send("/api/bakorin/items");
    expect(list.status).toBe(200);
    expect(((await list.json()) as { data: unknown[] }).data).toHaveLength(1);
    expect(site.jar.get("bakorin_access")).not.toBe("expired.token.value");
    expect(site.jar.get("bakorin_refresh")).not.toBe(oldRefresh);

    const refreshBefore = site.jar.get("bakorin_refresh")!;
    const logout = await site.send("/api/bakorin/auth/logout", { method: "POST" });
    expect(logout.status).toBeLessThan(300);
    expect(site.jar.size).toBe(0);
    // The refresh token was revoked by Bakorin, not just forgotten by the browser.
    const reuse = await runtime.app.request("/api/v1/auth/refresh", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refreshToken: refreshBefore }),
    });
    expect(reuse.status).toBe(401);
    expect((await site.send("/api/bakorin/items")).status).toBe(401);
  });

  test("Astro and Next adapters wrap the same handler", async () => {
    const runtime = await started();
    const astro = createAstroProxy({ baseUrl: "http://x", fetch: upstream(runtime) });
    const next = createNextProxy({ baseUrl: "http://x", fetch: upstream(runtime) });
    const viaAstro = await astro({ request: new Request(`${SITE}/api/bakorin/notes`) });
    const viaNext = await next.GET(new Request(`${SITE}/api/bakorin/notes`));
    expect(viaAstro.status).toBe(200);
    expect(viaNext.status).toBe(200);
    expect(typeof next.POST).toBe("function");
  });
});

describe("sdk subscribe", () => {
  test("one shared stream per client, filtered by entity, unsubscribes cleanly", async () => {
    const runtime = await started();
    const pat = await user(runtime, "pat@example.test");
    const opens: string[] = [];
    const api = createClient({
      baseUrl: "http://bakorin.test",
      getAccessToken: () => pat.token,
      fetch: (input, init) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith("/realtime")) opens.push(url.searchParams.get("entities") ?? "");
        return runtime.app.request(`${url.pathname}${url.search}`, init);
      },
    });
    cleanups.push(() => api.closeRealtime());
    const items: RealtimeChange[] = [];
    const notes: RealtimeChange[] = [];
    const statuses: string[] = [];
    api.subscribe("items", (change) => items.push(change), { onStatus: (s) => statuses.push(s) });
    const stopSecond = api.subscribe("items", () => undefined);
    api.subscribe("notes", (change) => notes.push(change));
    await until(() => statuses.includes("open"));
    expect(opens).toEqual(["items,notes"]);

    await api.entity("items").create({ title: "Sweep the porch", ownerId: pat.id });
    await api.entity("notes").create({ body: "Hello from Maple Street" });
    await until(() => items.length === 1 && notes.length === 1);
    expect(items[0]).toMatchObject({ entity: "items", op: "create", record: { title: "Sweep the porch" } });
    expect(items[0]!.eventId).toMatch(/^\d+$/);
    stopSecond();
    await Bun.sleep(50);
    expect(opens).toHaveLength(1);
  });

  test("reconnects after a dropped stream and replays what it missed", async () => {
    const runtime = await started();
    const pat = await user(runtime, "pat@example.test");
    let opens = 0;
    let cut: (() => void) | null = null;
    const lastIds: Array<string | null> = [];
    const api = createClient({
      baseUrl: "http://bakorin.test",
      getAccessToken: () => pat.token,
      fetch: async (input, init) => {
        const url = new URL(String(input));
        const response = await runtime.app.request(`${url.pathname}${url.search}`, init);
        if (!url.pathname.endsWith("/realtime")) return response;
        opens += 1;
        lastIds.push(new Headers(init?.headers).get("last-event-id"));
        if (opens > 1) return response;
        // Wrap the first stream so the test can drop it like a flaky network.
        const reader = response.body!.getReader();
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            cut = () => {
              void reader.cancel();
              controller.close();
            };
          },
          async pull(controller) {
            const { value, done } = await reader.read().catch(() => ({ value: undefined, done: true }));
            if (done) controller.close();
            else controller.enqueue(value!);
          },
        });
        return new Response(body, { status: response.status, headers: response.headers });
      },
    });
    cleanups.push(() => api.closeRealtime());
    const seen: string[] = [];
    let open = false;
    api.subscribe("items", (change) => seen.push((change.record as { title: string }).title), {
      onStatus: (status) => (open = status === "open"),
    });
    await until(() => open);
    await api.entity("items").create({ title: "First", ownerId: pat.id });
    await until(() => seen.length === 1);
    cut!();
    await until(() => !open);
    await api.entity("items").create({ title: "Missed while offline", ownerId: pat.id });
    // The server asked for retry: 3000, so the SDK waits about that long.
    await until(() => seen.length === 2, 8000);
    expect(seen).toEqual(["First", "Missed while offline"]);
    expect(opens).toBe(2);
    expect(lastIds[0]).toBeNull();
    expect(lastIds[1]).toMatch(/^\d+$/);
  });

  test("works through the pass through route with cookies (browser client)", async () => {
    const runtime = await started();
    await user(runtime, "pat@example.test");
    const proxy = createProxyHandler({ baseUrl: "http://bakorin.internal", fetch: upstream(runtime) });
    const site = browser(proxy);
    const login = await site.send("/api/bakorin/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "pat@example.test", password: "password123" }),
    });
    expect(login.status).toBe(200);
    const api = createBrowserClient({
      origin: SITE,
      basePath: "/api/bakorin",
      fetch: (input, init) => site.send(new URL(String(input)).pathname + new URL(String(input)).search, init ?? {}),
    });
    expect(createBrowserClient({ origin: SITE, basePath: "/api/bakorin" })).toBe(api);
    cleanups.push(() => api.closeRealtime());
    const seen: RealtimeChange[] = [];
    let open = false;
    api.subscribe("items", (change) => seen.push(change), { onStatus: (s) => (open = s === "open") });
    await until(() => open);
    // The write also goes through the proxy (same origin, cookie auth).
    const me = (await (await site.send("/api/bakorin/auth/me")).json()) as { data: { id: string } };
    await api.entity("items").create({ title: "Live through Astro", ownerId: me.data.id });
    await until(() => seen.length === 1);
    expect(seen[0]!.record).toMatchObject({ title: "Live through Astro" });
  });
});
