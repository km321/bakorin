import { afterEach, describe, expect, test } from "bun:test";
import { BakorinRequestError, createClient, type BakorinClient, type RealtimeChange } from "@bakorin/sdk";
import { createProxyHandler } from "@bakorin/sdk/proxy";
import { authMiddleware, requireUser } from "@bakorin/sdk/next";
import { requireAuth } from "@bakorin/sdk/astro";
import {
  applyChange,
  changedFields,
  checkFile,
  coerceValue,
  createAuth,
  createCollection,
  createForm,
  createStore,
  fieldErrorsFrom,
  fieldLabel,
  formFields,
  pageInfo,
  themeFromBrandingCss,
  uploadFile,
  validateRecord,
  type EntitySchema,
  type FieldSchema,
} from "@bakorin/sdk/headless";
import { isProtected, refreshUrl } from "../packages/sdk/src/guard.ts";
import { escapeHtml, renderField, renderTableBody, tableConfig } from "../packages/sdk/src/elements/render.ts";
import { brandingCss, compileAppYaml, generateTypes } from "@bakorin/core";
import { boot, MINI_YAML } from "./helpers.ts";

const cleanups: (() => unknown)[] = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

const TASKS: EntitySchema = {
  name: "tasks",
  display: "title",
  fields: [
    { name: "id", type: "text", required: true, writable: "none", system: true },
    { name: "title", type: "text", required: true },
    { name: "done", type: "boolean", required: true, defaultValue: false },
    { name: "points", type: "integer" },
    { name: "status", type: "enum", enumValues: ["open", "closed"] },
    { name: "due", type: "date" },
    { name: "ownerId", type: "relation", relation: { to: "users" }, required: true, owner: true },
    { name: "secretNote", type: "text", writable: "admin" },
  ],
};

describe("store", () => {
  test("notifies on change, skips identical values, and unsubscribes", () => {
    const store = createStore(1);
    const seen: number[] = [];
    const stop = store.subscribe((value) => seen.push(value));
    store.set(2);
    store.set(2);
    store.set((n) => n + 1);
    stop();
    store.set(9);
    expect(seen).toEqual([2, 3]);
    expect(store.get()).toBe(9);
  });
});

describe("schema helpers", () => {
  test("form fields skip system, owner, and admin only fields", () => {
    expect(formFields(TASKS).map((f) => f.name)).toEqual(["title", "done", "points", "status", "due"]);
    expect(formFields(TASKS, { isAdmin: true }).map((f) => f.name)).toContain("secretNote");
    expect(formFields(TASKS, { include: ["due", "title"] }).map((f) => f.name)).toEqual(["due", "title"]);
  });
  test("labels read like words", () => {
    expect(fieldLabel("dueDate")).toBe("Due date");
    expect(fieldLabel("ownerId")).toBe("Owner");
    expect(fieldLabel("first_name")).toBe("First name");
  });
  test("typegen writes bakorinSchema with owner and system markers and no secrets", () => {
    process.env.BAKORIN_ENV = "development";
    const ast = compileAppYaml(MINI_YAML.replace("  jwt:\n    secret: test-jwt-secret-0123456789-abcdefghijklmnop\n", "  jwt:\n    secret: test-jwt-secret-0123456789-abcdefghijklmnop\n"));
    const out = generateTypes(ast);
    expect(out).toContain("export const bakorinSchema");
    const json = out.slice(out.indexOf("= {") + 2, out.lastIndexOf("} as const") + 1);
    const schema = JSON.parse(json);
    const items = schema.entities.items.fields;
    expect(items.find((f: FieldSchema) => f.name === "ownerId").owner).toBe(true);
    expect(items.find((f: FieldSchema) => f.name === "id").system).toBe(true);
    expect(schema.auth.entity).toBe("users");
    expect(json).not.toContain("test-jwt-secret");
  });
});

describe("form helpers", () => {
  test("coerces input strings by field type", () => {
    expect(coerceValue({ name: "n", type: "integer" }, "42")).toBe(42);
    expect(coerceValue({ name: "n", type: "number" }, "")).toBeNull();
    expect(coerceValue({ name: "b", type: "boolean" }, "on")).toBe(true);
    expect(coerceValue({ name: "t", type: "relation", relation: { to: "x", many: true } }, ["a", ""])).toEqual(["a"]);
    expect(coerceValue({ name: "d", type: "datetime" }, "2026-01-02T03:04")).toMatch(/^2026-01-0\dT\d\d:04:00\.000Z$/);
  });
  test("validates like the server", () => {
    const errors = validateRecord(formFields(TASKS), { title: "", points: 1.5, status: "maybe", due: "tomorrow" });
    expect(errors).toEqual({
      title: "Title is required",
      points: "Points must be a whole number",
      status: "Status must be one of open, closed",
      due: "Due must be a date (YYYY-MM-DD)",
    });
    expect(validateRecord([{ name: "password", type: "password", required: true }], { password: "short" })).toEqual({
      password: "Password must be at least 8 characters",
    });
    expect(validateRecord([{ name: "password", type: "password", required: true, minLength: 0 }], { password: "x" })).toEqual({});
    // Fields with a default may be left out on create.
    expect(validateRecord(formFields(TASKS), { title: "ok" })).toEqual({});
  });
  test("changedFields keeps only edits and treats empty values alike", () => {
    expect(changedFields({ title: "a", done: false, note: null, tags: ["x"] }, { title: "a", done: true, note: "", tags: ["x"] })).toEqual({ done: true });
  });
  test("server errors land on the field with its label", () => {
    const mapped = fieldErrorsFrom(new BakorinRequestError("title is required", 400, "invalid_input", "title"), ["title"]);
    expect(mapped).toEqual({ fields: { title: "Title is required" } });
    expect(fieldErrorsFrom(new BakorinRequestError("ownerId is required", 400, "invalid_input", "ownerId"), ["title"]).message).toBe(
      "ownerId is required",
    );
    expect(fieldErrorsFrom(new Error("boom")).message).toBe("boom");
  });
  test("createForm sends all values on create and only changes on update", async () => {
    const sent: unknown[] = [];
    const create = createForm({ fields: formFields(TASKS), submit: async (values) => (sent.push(values), values) });
    create.setValue("title", "Write docs");
    create.setValue("points", "3");
    await create.submit();
    expect(sent[0]).toEqual({ title: "Write docs", done: false, points: 3 });

    const update = createForm({
      fields: formFields(TASKS),
      initial: { title: "Old", done: false, points: 1, status: "open", due: null },
      submit: async (values, mode) => (sent.push([mode, values]), values),
    });
    update.setValue("title", "New");
    await update.submit();
    expect(sent[1]).toEqual(["update", { title: "New" }]);
    // Nothing changed since the save: an empty PATCH.
    await update.submit();
    expect(sent[2]).toEqual(["update", {}]);
  });
  test("createForm blocks invalid input and maps server errors", async () => {
    let calls = 0;
    const form = createForm({
      fields: formFields(TASKS),
      submit: async () => {
        calls += 1;
        throw new BakorinRequestError("title must be unique", 409, "conflict", "title");
      },
    });
    expect(await form.submit()).toBeUndefined();
    expect(calls).toBe(0);
    expect(form.store.get().errors.title).toBe("Title is required");
    form.setValue("title", "dup");
    expect(form.store.get().errors.title).toBeUndefined();
    await form.submit();
    expect(form.store.get().errors).toEqual({ title: "Title must be unique" });
    expect(form.store.get().submitting).toBe(false);
  });
});

type Row = { id: string; title: string; done?: boolean };

function fakeClient(rows: Row[], fail: Partial<Record<"create" | "update" | "delete", boolean>> = {}) {
  const listeners: ((change: RealtimeChange) => void)[] = [];
  let next = rows.length;
  const api = {
    async list(query: { limit?: number; offset?: number } = {}) {
      const offset = query.offset ?? 0;
      const limit = query.limit ?? 20;
      return { data: rows.slice(offset, offset + limit), meta: { total: rows.length, limit, offset } };
    },
    async get(id: string) {
      return rows.find((row) => row.id === id);
    },
    async create(body: Partial<Row>) {
      await Bun.sleep(1);
      if (fail.create) throw new BakorinRequestError("nope", 400, "invalid_input", "title");
      const row = { ...body, id: `r${++next}` } as Row;
      rows.unshift(row);
      return row;
    },
    async update(id: string, patch: Partial<Row>) {
      await Bun.sleep(1);
      if (fail.update) throw new Error("update failed");
      const row = rows.find((r) => r.id === id)!;
      Object.assign(row, patch);
      return { ...row };
    },
    async delete(id: string) {
      await Bun.sleep(1);
      if (fail.delete) throw new Error("delete failed");
      rows.splice(rows.findIndex((r) => r.id === id), 1);
    },
  };
  const client = {
    entity: () => api,
    subscribe: (_entity: string, handler: (change: RealtimeChange) => void, options: { onStatus?: (s: "open") => void }) => {
      listeners.push(handler);
      options.onStatus?.("open");
      return () => listeners.splice(listeners.indexOf(handler), 1);
    },
  } as unknown as BakorinClient;
  return { client, emit: (change: RealtimeChange) => listeners.forEach((listener) => listener(change)) };
}

const seed = (n: number): Row[] => Array.from({ length: n }, (_, i) => ({ id: `r${i + 1}`, title: `Task ${i + 1}`, done: false }));

describe("collections", () => {
  test("pages through results", async () => {
    const { client } = fakeClient(seed(5));
    const list = createCollection<Row>(client, "tasks", { limit: 2 });
    await list.load();
    expect(list.store.get().items.map((r) => r.id)).toEqual(["r1", "r2"]);
    await list.next();
    expect(list.store.get().items.map((r) => r.id)).toEqual(["r3", "r4"]);
    expect(pageInfo(list.store.get())).toMatchObject({ page: 1, pages: 3, from: 3, to: 4, hasNext: true, hasPrevious: true });
    await list.next();
    await list.next();
    expect(list.store.get().offset).toBe(4);
    await list.previous();
    expect(list.store.get().offset).toBe(2);
  });

  test("optimistic create shows the row at once and swaps in the saved record", async () => {
    const { client } = fakeClient(seed(2));
    const list = createCollection<Row>(client, "tasks");
    await list.load();
    const pending = list.create({ title: "New" });
    expect(list.store.get().items[0]).toMatchObject({ title: "New" });
    expect(String(list.store.get().items[0]!.id)).toStartWith("pending-");
    expect(list.store.get().total).toBe(3);
    const saved = await pending;
    expect(list.store.get().items[0]).toEqual(saved);
    expect(list.store.get().total).toBe(3);
  });

  test("a realtime create that beats the response does not duplicate the row", async () => {
    const { client, emit } = fakeClient(seed(1));
    const list = createCollection<Row>(client, "tasks");
    await list.load();
    list.live();
    const pending = list.create({ title: "Race" });
    emit({ eventId: "1", entity: "tasks", op: "create", id: "r2", record: { id: "r2", title: "Race" }, at: 0 });
    await pending;
    expect(list.store.get().items.map((r) => r.id)).toEqual(["r2", "r1"]);
    expect(list.store.get().total).toBe(2);
  });

  test("failed writes roll back and keep the error", async () => {
    const { client } = fakeClient(seed(3), { create: true, update: true, delete: true });
    const list = createCollection<Row>(client, "tasks");
    await list.load();
    const before = structuredClone(list.store.get().items);
    await expect(list.create({ title: "x" })).rejects.toThrow("nope");
    await expect(list.update("r2", { done: true })).rejects.toThrow("update failed");
    await expect(list.remove("r2")).rejects.toThrow("delete failed");
    expect(list.store.get().items).toEqual(before);
    expect(list.store.get().total).toBe(3);
    expect(list.store.get().error).toBe("delete failed");
  });

  test("applyChange updates, deletes, and only prepends on the first page", () => {
    const state = { items: seed(2), total: 2, offset: 0, limit: 2 };
    expect(applyChange(state, { eventId: "1", entity: "t", op: "update", id: "r1", record: { id: "r1", title: "Edited" }, at: 0 }).items[0]!.title).toBe("Edited");
    expect(applyChange(state, { eventId: "2", entity: "t", op: "delete", id: "r2", at: 0 })).toEqual({ items: [state.items[0]!], total: 1 });
    const created = applyChange(state, { eventId: "3", entity: "t", op: "create", id: "r9", record: { id: "r9", title: "N" }, at: 0 });
    expect(created.items.map((r) => r.id)).toEqual(["r9", "r1"]);
    expect(created.total).toBe(3);
    const later = applyChange({ ...state, offset: 2 }, { eventId: "4", entity: "t", op: "create", id: "r9", record: { id: "r9", title: "N" }, at: 0 });
    expect(later.items).toBe(state.items);
    expect(later.total).toBe(3);
  });
});

describe("uploads and theme", () => {
  test("checkFile catches size and type before sending", () => {
    expect(checkFile({ size: 20, type: "image/png" }, { maxBytes: 10 })).toBe("The file is larger than 10 B");
    expect(checkFile({ size: 1, type: "text/html" }, { accept: ["image/*", "application/pdf"] })).toBe("This file type is not allowed");
    expect(checkFile({ size: 1, type: "image/webp" }, { accept: ["image/*"] })).toBeUndefined();
  });
  test("branding colors map onto the component variables", () => {
    const css = brandingCss({
      warnings: [],
      light: { accent: "#0f766e", accentFg: "#ffffff", accentSoft: "#ccfbf1", focus: "#0f766e" },
      dark: { accent: "#5eead4", accentFg: "#042f2e", accentSoft: "#134e4a", focus: "#5eead4" },
    } as never);
    const theme = themeFromBrandingCss(css);
    expect(theme).toContain(':root, :root[data-theme="light"] { --bk-accent-fg: #ffffff; --bk-accent-soft: #ccfbf1; --bk-accent: #0f766e; --bk-focus: #0f766e; }');
    expect(theme).toContain('--bk-accent: #5eead4;');
    expect(theme).not.toContain("--docs-");
    expect(themeFromBrandingCss("")).toBe("");
    expect(themeFromBrandingCss(":root { --accent: red; } body{x} :root { --accent: url(javascript:x); }")).toBe("");
  });
});

describe("guards", () => {
  test("protect prefixes match whole segments and next stays on site", () => {
    expect(isProtected("/app", ["/app"])).toBe(true);
    expect(isProtected("/app/tasks", ["/app"])).toBe(true);
    expect(isProtected("/apple", ["/app"])).toBe(false);
    expect(refreshUrl("//evil.example/x")).toBe("/api/bakorin/-/refresh?next=%2F&fail=%2Flogin");
    expect(refreshUrl("/app?tab=1", { loginPath: "/signin" })).toBe("/api/bakorin/-/refresh?next=%2Fapp%3Ftab%3D1&fail=%2Fsignin");
  });

  test("authMiddleware redirects without a session and lets valid sessions through", async () => {
    const guard = authMiddleware({
      baseUrl: "http://bakorin.test",
      roles: ["admin"],
      fetch: (async (_url: URL, init: RequestInit) => {
        const auth = new Headers(init.headers).get("authorization");
        if (auth === "Bearer good-admin") return Response.json({ data: { id: "1", role: "admin" } });
        if (auth === "Bearer good-user") return Response.json({ data: { id: "2", role: "user" } });
        return new Response("{}", { status: 401 });
      }) as typeof fetch,
    });
    expect(await guard(new Request("http://site.test/"))).toBeUndefined();
    const out = (await guard(new Request("http://site.test/app/x")))!;
    expect(out.status).toBe(307);
    expect(out.headers.get("location")).toBe("http://site.test/api/bakorin/-/refresh?next=%2Fapp%2Fx&fail=%2Flogin");
    expect((await guard(new Request("http://site.test/app", { headers: { cookie: "bakorin_access=bad" } })))!.status).toBe(307);
    expect((await guard(new Request("http://site.test/app", { headers: { cookie: "a=1; bakorin_access=good-user" } })))!.status).toBe(403);
    expect(await guard(new Request("http://site.test/app", { headers: { cookie: "bakorin_access=good-admin" } }))).toBeUndefined();
  });

  test("requireUser returns the user or redirects through refresh", async () => {
    const redirect = (url: string): never => {
      throw new Error(`redirect:${url}`);
    };
    expect(await requireUser({ me: async () => ({ id: "1" }) }, { redirect })).toEqual({ id: "1" });
    await expect(requireUser({ me: async () => Promise.reject(new Error("401")) }, { redirect, next: "/app" })).rejects.toThrow(
      "redirect:/api/bakorin/-/refresh?next=%2Fapp&fail=%2Flogin",
    );
  });
});

describe("markup", () => {
  test("fields are labelled and errors are described", () => {
    const html = renderField({ name: "title", type: "text", required: true }, { idPrefix: "f", error: "Title is required", value: '<b>"x"' });
    expect(html).toContain('<label class="bk-label" for="f-title-input">Title');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('aria-describedby="f-title-error"');
    expect(html).toContain('value="&lt;b&gt;&quot;x&quot;"');
    expect(escapeHtml("<script>")).toBe("&lt;script&gt;");
  });
  test("table rows escape values and name their controls", () => {
    const config = tableConfig("tasks", TASKS, { columns: ["title", "done"], toggle: ["done"], deletable: true });
    const html = renderTableBody(config, { items: [{ id: "r1", title: "<img src=x>", done: true }], total: 1, limit: 20, offset: 0, error: null, loading: false });
    expect(html).not.toContain("<img");
    expect(html).toContain('aria-label="Done: &lt;img src=x&gt;"');
    expect(html).toContain('aria-label="Delete &lt;img src=x&gt;"');
  });
});

// End to end through the pass through route: the browser client, cookies, and the real server.
const SITE = "http://site.test";
const YAML = MINI_YAML.replace(
  "entities:\n",
  `entities:
  notes:
    realtime: true
    fields:
      body: { type: text, required: true }
      ownerId: { type: relation, to: users, required: true }
    policies:
      read: owner(ownerId)
      create: authenticated
      update: owner(ownerId)
      delete: owner(ownerId)
`,
).replace("  files:\n    path: ./data/uploads\n", "  files:\n    path: ./data/uploads\n    maxBytes: 1048576\n");

async function site() {
  const runtime = await boot(YAML);
  cleanups.push(() => runtime.close());
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", idleTimeout: 0, fetch: (req, s) => runtime.app.fetch(req, s) });
  cleanups.push(() => server.stop(true));
  const proxy = createProxyHandler({ baseUrl: `http://127.0.0.1:${server.port}`, getClientIp: () => "203.0.113.5" });
  const jar = new Map<string, string>();
  // A tiny browser: same origin requests to the proxy with a cookie jar.
  const browserFetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input instanceof Request ? input.url : input), SITE);
    const headers = new Headers(init.headers);
    headers.set("cookie", [...jar].map(([k, v]) => `${k}=${v}`).join("; "));
    if ((init.method ?? "GET") !== "GET") headers.set("origin", SITE);
    headers.set("sec-fetch-site", "same-origin");
    const response = await proxy(new Request(url, { ...init, headers }));
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(";");
      const [name, ...rest] = pair!.split("=");
      const value = rest.join("=");
      if (!value || /max-age=0/i.test(cookie)) jar.delete(name!);
      else jar.set(name!, value);
    }
    return response;
  };
  // What createBrowserClient builds, without its per tab cache (other test files share this process).
  const client = createClient({ baseUrl: SITE, apiPath: "/api/bakorin", credentials: "same-origin", fetch: browserFetch as typeof fetch }) as BakorinClient;
  return { runtime, client, jar, browserFetch };
}

describe("through the pass through route", () => {
  test("auth, CRUD with field errors, and uploads work with httpOnly cookies only", async () => {
    const { client, jar, browserFetch } = await site();
    const auth = createAuth(client);
    expect(await auth.refresh()).toBeNull();
    expect(auth.store.get().status).toBe("signed-out");

    const signup = await auth.signUp({ email: "kit@example.test", password: "password123", name: "Kit" });
    expect(signup?.status).toBe("check_email");
    expect(await auth.signIn({ email: "kit@example.test", password: "wrong-password" })).toBeNull();
    expect(auth.store.get().error).toBeTruthy();
    const user = await auth.signIn({ email: "kit@example.test", password: "password123" });
    expect(user).toMatchObject({ email: "kit@example.test" });
    expect(jar.has("bakorin_access")).toBe(true);
    expect(JSON.stringify(user)).not.toContain("accessToken");

    const notes = createCollection<{ id: string; body: string }>(client, "notes");
    await notes.load();
    expect(notes.store.get().items).toEqual([]);
    const saved = await notes.create({ body: "Hello" });
    expect(saved.body).toBe("Hello");
    const error = await client.entity("notes").create({}).catch((e) => e);
    expect(error).toBeInstanceOf(BakorinRequestError);
    expect(error).toMatchObject({ status: 400, code: "invalid_input", field: "body", message: "body is required" });
    await notes.update(saved.id, { body: "Edited" });
    await notes.load();
    expect(notes.store.get().items.map((n) => n.body)).toEqual(["Edited"]);

    // Upload with the fetch path (no XMLHttpRequest in Bun), then sign a fresh link.
    {
      const file = new File(["hello"], "hello.txt", { type: "text/plain" });
      const stored = await uploadFile(file, { origin: SITE, fetch: browserFetch });
      expect(stored).toMatchObject({ filename: "hello.txt", size: 5 });
      expect(stored.url).toStartWith(`${SITE}/api/bakorin/files/${stored.id}?`);
      expect(await (await browserFetch(stored.url)).text()).toBe("hello");
      const signed = await client.files.sign(stored.id);
      expect(signed.url).toStartWith(`${SITE}/api/bakorin/files/`);
      const download = await browserFetch(signed.url);
      expect(await download.text()).toBe("hello");
      expect(download.headers.get("x-content-type-options")).toBe("nosniff");
      const big = await uploadFile(new File([new Uint8Array(2 * 1024 * 1024)], "big.bin"), { origin: SITE, fetch: browserFetch }).catch((e) => e);
      expect(big).toBeInstanceOf(BakorinRequestError);
      expect(big.status).toBe(413);
    }

    await notes.remove(saved.id);
    await auth.signOut();
    expect(auth.store.get().status).toBe("signed-out");
    expect(jar.has("bakorin_access")).toBe(false);
    expect(await auth.refresh()).toBeNull();
  });

  test("Astro requireAuth sets locals.user and sends signed out visitors to refresh", async () => {
    const { runtime } = await site();
    const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: (req, s) => runtime.app.fetch(req, s) });
    cleanups.push(() => server.stop(true));
    const base = `http://127.0.0.1:${server.port}`;
    await fetch(`${base}/api/v1/auth/signup`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "a@example.test", password: "password123", name: "A" }) });
    const login = await (await fetch(`${base}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "a@example.test", password: "password123" }) })).json();
    const middleware = requireAuth({ baseUrl: base, protect: ["/app"] });
    const context = (path: string, token?: string) => {
      const locals: Record<string, unknown> = {};
      return {
        locals,
        ctx: {
          url: new URL(`${SITE}${path}`),
          request: new Request(`${SITE}${path}`),
          cookies: { get: (name: string) => (name === "bakorin_access" && token ? { value: token } : undefined), set: () => undefined },
          locals,
          redirect: (to: string) => new Response(null, { status: 302, headers: { location: to } }),
          clientAddress: "203.0.113.9",
        },
      };
    };
    const ok = () => Promise.resolve(new Response("page"));
    const open = context("/");
    expect(await (await middleware(open.ctx, ok)).text()).toBe("page");
    expect(open.locals.user).toBeNull();
    const blocked = context("/app/tasks?x=1");
    const redirect = await middleware(blocked.ctx, ok);
    expect(redirect.headers.get("location")).toBe("/api/bakorin/-/refresh?next=%2Fapp%2Ftasks%3Fx%3D1&fail=%2Flogin");
    const signed = context("/app", login.data.accessToken);
    expect(await (await middleware(signed.ctx, ok)).text()).toBe("page");
    expect(signed.locals.user).toMatchObject({ email: "a@example.test" });
  });
});
