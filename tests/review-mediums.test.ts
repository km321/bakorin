// Regression tests for the Medium findings in the November 2026 review.
import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { compileAppYaml, SchemaError } from "@bakorin/core";
import { migrateToSchema, openSqlite } from "@bakorin/server";
import { signForSend } from "../packages/server/src/webhooks/dispatcher.ts";
import { signWebhookPayload } from "@bakorin/server";
import { likePattern } from "../packages/server/src/crud/query.ts";
import { contentMatchesType, fileResponseHeaders } from "../packages/server/src/files/routes.ts";
import { JSON_BODY_LIMIT_BYTES, requestBodyLimit } from "../packages/server/src/app.ts";
import { REFRESH_TABLE } from "../packages/server/src/db/system.ts";
import { boot, MINI_YAML, tempProject } from "./helpers.ts";

const SECRET = "test-jwt-secret-0123456789-abcdefghijklmnop";
const ENV = { JWT_SECRET: SECRET };

const cleanups: Array<() => Promise<unknown> | unknown> = [];
afterEach(async () => {
  while (cleanups.length) {
    await cleanups.pop()!();
  }
});

type Runtime = Awaited<ReturnType<typeof boot>>;

async function started(yaml?: string): Promise<Runtime> {
  const runtime = await boot(yaml);
  cleanups.push(() => runtime.close());
  return runtime;
}

async function j(runtime: Runtime, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await runtime.app.fetch(
    new Request(`http://x${path}`, {
      method,
      headers: { "content-type": "application/json", ...headers },
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    // empty body
  }
  return { status: res.status, json, headers: res.headers };
}

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

async function signup(runtime: Runtime, email: string) {
  const res = await j(runtime, "POST", "/api/v1/auth/signup", { email, password: "password123", name: email.split("@")[0] });
  return res.json.data as { accessToken: string; refreshToken: string; user: { id: string } };
}

async function firstAdmin(runtime: Runtime) {
  const res = await j(runtime, "POST", "/api/v1/auth/first-admin", { email: "boss@x.test", password: "password123", name: "Boss" });
  return res.json.data as { accessToken: string; refreshToken: string; user: { id: string } };
}

describe("M1 and M2: refresh rotation is atomic, with a grace window", () => {
  test("parallel refreshes of one token share one successor (probe P5)", async () => {
    const runtime = await started();
    const user = await signup(runtime, "r@x.test");
    const results = await Promise.all([1, 2, 3].map(() => j(runtime, "POST", "/api/v1/auth/refresh", { refreshToken: user.refreshToken })));
    expect(results.map((res) => res.status)).toEqual([200, 200, 200]);
    const tokens = new Set(results.map((res) => res.json.data.refreshToken));
    expect(tokens.size).toBe(1);
    const live = await runtime.db.selectFrom(REFRESH_TABLE).selectAll().where("user_id", "=", user.user.id).where("revoked_at", "is", null).execute();
    expect(live.length).toBe(1);
  });

  test("reuse after the grace window revokes every session", async () => {
    const runtime = await started();
    const user = await signup(runtime, "g@x.test");
    const first = await j(runtime, "POST", "/api/v1/auth/refresh", { refreshToken: user.refreshToken });
    expect(first.status).toBe(200);
    await runtime.db.updateTable(REFRESH_TABLE).set({ rotated_at: new Date(Date.now() - 31_000).toISOString() }).where("rotated_at", "is not", null).execute();
    const reuse = await j(runtime, "POST", "/api/v1/auth/refresh", { refreshToken: user.refreshToken });
    expect(reuse.status).toBe(401);
    const successor = await j(runtime, "POST", "/api/v1/auth/refresh", { refreshToken: first.json.data.refreshToken });
    expect(successor.status).toBe(401);
  });
});

describe("M3: access tokens are checked against the database", () => {
  test("a deleted user's token stops working at once (probe P4)", async () => {
    const runtime = await started();
    const admin = await firstAdmin(runtime);
    const user = await signup(runtime, "gone@x.test");
    expect((await j(runtime, "GET", "/api/v1/auth/me", undefined, bearer(user.accessToken))).status).toBe(200);
    expect((await j(runtime, "DELETE", `/api/v1/users/${user.user.id}`, undefined, bearer(admin.accessToken))).status).toBeLessThan(300);
    expect((await j(runtime, "GET", "/api/v1/users", undefined, bearer(user.accessToken))).status).toBe(401);
    expect((await j(runtime, "POST", "/api/v1/items", { title: "ghost" }, bearer(user.accessToken))).status).toBe(401);
  });

  test("a demoted admin loses admin access with the same token", async () => {
    const runtime = await started();
    const admin = await firstAdmin(runtime);
    expect((await j(runtime, "GET", "/api/v1/audit", undefined, bearer(admin.accessToken))).status).toBe(200);
    await runtime.db.updateTable("users").set({ role: "user" }).where("id", "=", admin.user.id).execute();
    expect((await j(runtime, "GET", "/api/v1/audit", undefined, bearer(admin.accessToken))).status).toBe(403);
  });

  test("logout everywhere rejects access tokens issued before it", async () => {
    const runtime = await started();
    const user = await signup(runtime, "out@x.test");
    const out = await j(runtime, "POST", "/api/v1/auth/logout", { all: true }, bearer(user.accessToken));
    expect(out.status).toBe(200);
    expect((await j(runtime, "GET", "/api/v1/auth/me", undefined, bearer(user.accessToken))).status).toBe(401);
    const login = await j(runtime, "POST", "/api/v1/auth/login", { email: "out@x.test", password: "password123" });
    expect((await j(runtime, "GET", "/api/v1/auth/me", undefined, bearer(login.json.data.accessToken))).status).toBe(200);
  });
});

describe("M4: entity names cannot shadow built in routes", () => {
  test("an entity named audit or files is a schema error (probe P6)", () => {
    for (const name of ["audit", "files", "Backups", "webhooks", "mail", "status", "auth", "docs", "_meta"]) {
      const yaml = MINI_YAML.replace("  items:\n", `  ${name}:\n`);
      expect(() => compileAppYaml(yaml, { env: ENV })).toThrow(SchemaError);
    }
    expect(() => compileAppYaml(MINI_YAML.replace("  items:\n", "  audits:\n"), { env: ENV })).not.toThrow();
  });
});

describe("M5: webhook retries are signed at send time", () => {
  test("each attempt carries a fresh timestamp and a matching signature", () => {
    const payload = JSON.stringify({ event: "items.create" });
    const stored = { "x-bakorin-delivery": "d1", "x-bakorin-timestamp": "2026-01-01T00:00:00.000Z", "x-bakorin-signature": "sha256=old" };
    const now = new Date("2026-11-15T12:00:00.000Z");
    const headers = signForSend(stored, payload, "webhook-secret-webhook-secret", now);
    expect(headers["x-bakorin-delivery"]).toBe("d1");
    expect(headers["x-bakorin-timestamp"]).toBe(now.toISOString());
    expect(headers["x-bakorin-signature"]).toBe(`sha256=${signWebhookPayload("webhook-secret-webhook-secret", now.toISOString(), payload)}`);
    expect(signForSend(stored, payload, undefined, now)).toEqual(stored);
  });
});

describe("M6: a failed migration rolls back completely", () => {
  test("SQLite: an error partway leaves no new table and the old stored schema", async () => {
    const dir = await tempProject();
    const { db, raw } = openSqlite(join(dir, "data/app.db"));
    cleanups.push(() => db.destroy());
    const v1 = compileAppYaml(MINI_YAML, { env: ENV });
    await migrateToSchema(db, v1);
    const storedBefore = (await db.selectFrom("_bakorin_meta").select("value").where("key", "=", "schema_ast").executeTakeFirstOrThrow()).value;
    raw.run(`create trigger boom before update on _bakorin_meta when new.key = 'applied_at' begin select raise(abort, 'boom'); end`);
    const v2 = compileAppYaml(`${MINI_YAML}  extras:\n    fields:\n      label: { type: text }\n`, { env: ENV });
    await expect(migrateToSchema(db, v2)).rejects.toThrow(/boom/);
    expect(raw.query(`select name from sqlite_master where type = 'table' and name = 'extras'`).all().length).toBe(0);
    const storedAfter = (await db.selectFrom("_bakorin_meta").select("value").where("key", "=", "schema_ast").executeTakeFirstOrThrow()).value;
    expect(storedAfter).toBe(storedBefore);
  });
});

describe("M7: like is case insensitive and literal on every dialect", () => {
  test("likePattern escapes wildcards", () => {
    expect(likePattern("Hello")).toBe("%hello%");
    expect(likePattern("50%_off\\")).toBe("%50\\%\\_off\\\\%");
  });

  test("like=% does not match everything, and case is ignored", async () => {
    const runtime = await started();
    const user = await signup(runtime, "l@x.test");
    for (const title of ["Hello World", "50% off", "plain"]) {
      await j(runtime, "POST", "/api/v1/items", { title }, bearer(user.accessToken));
    }
    const hello = await j(runtime, "GET", "/api/v1/items?filter[title][like]=hello", undefined, bearer(user.accessToken));
    expect(hello.json.data.map((row: any) => row.title)).toEqual(["Hello World"]);
    const percent = await j(runtime, "GET", `/api/v1/items?filter[title][like]=${encodeURIComponent("%")}`, undefined, bearer(user.accessToken));
    expect(percent.json.data.map((row: any) => row.title)).toEqual(["50% off"]);
  });
});

describe("M8: request bodies are capped", () => {
  test("a JSON body over 1 MiB gets 413 before it is parsed", async () => {
    const runtime = await started();
    const user = await signup(runtime, "big@x.test");
    const big = JSON.stringify({ title: "x".repeat(JSON_BODY_LIMIT_BYTES + 10) });
    const res = await j(runtime, "POST", "/api/v1/items", big, bearer(user.accessToken));
    expect(res.status).toBe(413);
    expect(res.json.error.code).toBe("payload_too_large");
    expect((await j(runtime, "GET", "/health")).status).toBe(200);
  });

  test("uploads get the configured file limit", () => {
    const ast = compileAppYaml(MINI_YAML, { env: ENV });
    expect(requestBodyLimit(ast, "POST", "/api/v1/files")).toBe(ast.runtime.files.maxBytes + 64 * 1024);
    expect(requestBodyLimit(ast, "POST", "/api/v1/items")).toBe(JSON_BODY_LIMIT_BYTES);
  });
});

describe("M12: uploaded files cannot run script on our origin", () => {
  test("HTML and SVG download as sandboxed attachments; images stay inline", () => {
    for (const type of ["text/html", "image/svg+xml", "application/javascript", "application/octet-stream"]) {
      const headers = fileResponseHeaders(type, "evil.html");
      expect(headers["content-disposition"]).toStartWith("attachment");
      expect(headers["content-security-policy"]).toContain("sandbox");
      expect(headers["x-content-type-options"]).toBe("nosniff");
    }
    const png = fileResponseHeaders("image/png", "a\"b\r\n.png");
    expect(png["content-disposition"]).toStartWith("inline");
    expect(png["content-disposition"]).not.toContain("\r");
  });

  test("declared image and PDF types must match their magic bytes", async () => {
    expect(contentMatchesType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), "image/png")).toBe(true);
    expect(contentMatchesType(new TextEncoder().encode("<script>alert(1)</script>"), "image/png")).toBe(false);
    const runtime = await started();
    const user = await signup(runtime, "f@x.test");
    const form = new FormData();
    form.append("file", new File(["<html><script>alert(1)</script></html>"], "fake.png", { type: "image/png" }));
    const res = await runtime.app.fetch(new Request("http://x/api/v1/files", { method: "POST", body: form, headers: bearer(user.accessToken) }));
    expect(res.status).toBe(400);
  });
});

describe("M13: relations only point at records the writer can read", () => {
  const NOTES_YAML = `${MINI_YAML}  notes:
    fields:
      body: { type: text, required: true }
      itemId: { type: relation, to: items, required: true }
      ownerId: { type: relation, to: users, required: true }
    policies:
      read: owner(ownerId)
      create: authenticated
      update: owner(ownerId)
      delete: owner(ownerId)
`;

  test("user B cannot attach a note to user A's item (probe P7)", async () => {
    const runtime = await started(NOTES_YAML);
    const a = await signup(runtime, "a@x.test");
    const b = await signup(runtime, "b@x.test");
    const item = await j(runtime, "POST", "/api/v1/items", { title: "A's" }, bearer(a.accessToken));
    const steal = await j(runtime, "POST", "/api/v1/notes", { body: "hi", itemId: item.json.data.id }, bearer(b.accessToken));
    expect(steal.status).toBe(400);
    const missing = await j(runtime, "POST", "/api/v1/notes", { body: "hi", itemId: crypto.randomUUID() }, bearer(b.accessToken));
    expect(missing.status).toBe(400);
    expect(missing.json.error.message).toBe(steal.json.error.message);
    const own = await j(runtime, "POST", "/api/v1/notes", { body: "mine", itemId: item.json.data.id }, bearer(a.accessToken));
    expect(own.status).toBe(201);
    const move = await j(runtime, "PATCH", `/api/v1/notes/${own.json.data.id}`, { itemId: crypto.randomUUID() }, bearer(a.accessToken));
    expect(move.status).toBe(400);
  });
});
