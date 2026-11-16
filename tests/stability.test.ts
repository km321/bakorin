import { describe, expect, test } from "bun:test";
import { compileAppYaml, diffSchemas } from "@bakorin/core";
import { acquireLease, instanceHolder, migrateToSchema, openSqlite, signAccessToken, verifyAccessToken } from "@bakorin/server";
import { join } from "node:path";
import { MINI_YAML, boot, client, tempProject } from "./helpers.ts";

async function signup(runtime: Awaited<ReturnType<typeof boot>>, email: string) {
  const response = await client(runtime).fetch("/api/v1/auth/signup", {
    method: "POST",
    body: JSON.stringify({ email, password: "password123", name: email }),
  });
  return (await response.json()).data as { accessToken: string; user: { id: string; role: string } };
}

describe("stability", () => {
  test("JWT_SECRET_PREVIOUS still verifies rotated tokens", async () => {
    const previous = "old-secret-old-secret-old-secret-32";
    const current = "new-secret-new-secret-new-secret-32";
    const token = await signAccessToken({ sub: "u1", role: "user", ent: "users" }, previous, 60);
    const claims = await verifyAccessToken(token, current, previous);
    expect(claims.sub).toBe("u1");
    await expect(verifyAccessToken(token, current)).rejects.toBeTruthy();
  });

  test("security headers on admin and docs; HSTS when https", async () => {
    const runtime = await boot();
    const docs = await client(runtime).fetch("/docs");
    expect(docs.headers.get("content-security-policy") ?? "").toContain("frame-ancestors 'none'");
    expect(docs.headers.get("x-content-type-options")).toBe("nosniff");
    expect(docs.headers.get("referrer-policy")).toBe("no-referrer");
    expect(docs.headers.get("strict-transport-security")).toBeNull();
    const https = await client(runtime).fetch("/admin/", { headers: { "x-forwarded-proto": "https" } });
    expect(https.headers.get("strict-transport-security")).toContain("max-age=");
    expect(https.headers.get("content-security-policy") ?? "").toContain("frame-ancestors 'none'");
    await runtime.close();
  });

  test("private files require a signed URL", async () => {
    const runtime = await boot();
    const session = await signup(runtime, "files@example.com");
    const api = client(runtime, session.accessToken);
    const body = new FormData();
    body.set("file", new File(["hello bakorin"], "note.txt", { type: "text/plain" }));
    const uploaded = await api.fetch("/api/v1/files", { method: "POST", body });
    expect(uploaded.status).toBe(201);
    const json = (await uploaded.json()) as { data: { id: string; url: string } };
    expect(json.data.url).toContain("sig=");
    expect((await api.fetch(`/api/v1/files/${json.data.id}`)).status).toBe(401);
    const signed = await api.fetch(json.data.url);
    expect(signed.status).toBe(200);
    expect(await signed.text()).toBe("hello bakorin");
    const zip = new FormData();
    zip.set("file", new File(["nope"], "x.zip", { type: "application/zip" }));
    expect((await api.fetch("/api/v1/files", { method: "POST", body: zip })).status).toBe(400);
    await runtime.close();
  });

  test("account lockout after repeated failed logins", async () => {
    const runtime = await boot();
    await signup(runtime, "lock@example.com");
    let last = 0;
    for (let i = 0; i < 5; i += 1) {
      const response = await client(runtime).fetch("/api/v1/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: "lock@example.com", password: "wrong-password" }),
      });
      last = response.status;
    }
    expect(last).toBe(429);
    const locked = await client(runtime).fetch("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "lock@example.com", password: "password123" }),
    });
    expect(locked.status).toBe(429);
    await runtime.close();
  });

  test("audit log records login and is admin-only", async () => {
    const runtime = await boot();
    const user = await signup(runtime, "member@example.com");
    expect((await client(runtime, user.accessToken).fetch("/api/v1/audit")).status).toBe(403);
    await runtime.db.updateTable("users").set({ role: "admin" }).where("id", "=", user.user.id).execute();
    const login = await client(runtime).fetch("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "member@example.com", password: "password123" }),
    });
    const admin = (await login.json()).data as { accessToken: string };
    const audit = await client(runtime, admin.accessToken).fetch("/api/v1/audit");
    expect(audit.status).toBe(200);
    const payload = (await audit.json()) as { data: Array<{ action: string }>; meta: { total: number } };
    expect(payload.meta.total).toBeGreaterThan(0);
    expect(payload.data.some((row) => row.action === "login")).toBe(true);
    await runtime.close();
  });

  test("entity indexes in app.yaml are applied by the migrator", async () => {
    const yaml = MINI_YAML.replace(
      "      ownerId: { type: relation, to: users, required: true }",
      "      ownerId: { type: relation, to: users, required: true }\n    indexes:\n      - [ownerId, title]",
    );
    const ast = compileAppYaml(yaml, { env: { JWT_SECRET: "test-jwt-secret-0123456789-abcdefghijklmnop" } });
    expect(ast.entityMap.items?.indexes).toEqual([["ownerId", "title"]]);
    const from = compileAppYaml(MINI_YAML, { env: { JWT_SECRET: "test-jwt-secret-0123456789-abcdefghijklmnop" } });
    const plan = diffSchemas(from, ast);
    expect(plan.auto.some((change) => change.kind === "add_index")).toBe(true);
    const dir = await tempProject(yaml);
    const { db } = openSqlite(join(dir, "data/app.db"));
    await migrateToSchema(db, ast);
    const indexes = await db
      .selectFrom("sqlite_master")
      .select("name")
      .where("type", "=", "index")
      .execute();
    expect(indexes.some((row) => String(row.name).includes("items_ownerId_title"))).toBe(true);
    await db.destroy();
  });

  test("DB leases are exclusive across holders", async () => {
    const runtime = await boot();
    const a = instanceHolder();
    const b = instanceHolder();
    expect(await acquireLease(runtime.db, "job", a, 30_000)).toBe(true);
    expect(await acquireLease(runtime.db, "job", b, 30_000)).toBe(false);
    expect(await acquireLease(runtime.db, "job", a, 30_000)).toBe(true);
    await runtime.close();
  });
});
