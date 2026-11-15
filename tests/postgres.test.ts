import { describe, expect, test } from "bun:test";
import { bootPostgres, client } from "./helpers.ts";
import { exportPortable, importPortable } from "@bakorin/server";

const url = process.env.DATABASE_URL;

describe.skipIf(!url)("postgres", () => {
  test("migrator applies and auth works", async () => {
    const runtime = await bootPostgres();
    const signup = await client(runtime).fetch("/api/v1/auth/signup", {
      method: "POST",
      body: JSON.stringify({ email: "ada@studio.test", password: "password123", name: "Ada West" }),
    });
    expect(signup.status).toBe(201);
    const login = await client(runtime).fetch("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "ada@studio.test", password: "password123" }),
    });
    expect(login.status).toBe(200);
    expect((await login.json()).data.accessToken).toBeTypeOf("string");
    await runtime.close();
  });

  test("crud expand and owner isolation", async () => {
    const runtime = await bootPostgres();
    const signup = await client(runtime).fetch("/api/v1/auth/signup", {
      method: "POST",
      body: JSON.stringify({ email: "ada@studio.test", password: "password123", name: "Ada West" }),
    });
    const created = (await signup.json()).data as { accessToken: string; user: { id: string } };
    const api = client(runtime, created.accessToken);

    const item = await api.fetch("/api/v1/items", { method: "POST", body: JSON.stringify({ title: "Northwind" }) });
    expect(item.status).toBe(201);
    const itemJson = await item.json();
    expect(itemJson.data.ownerId).toBe(created.user.id);

    const expanded = await api.fetch(`/api/v1/items/${itemJson.data.id}?expand=ownerId`);
    const expandedJson = await expanded.json();
    expect(expandedJson.data.$expand.ownerId.name).toBe("Ada West");
    expect(expandedJson.data.$expand.ownerId.password).toBeUndefined();

    const staff = await client(runtime).fetch("/api/v1/auth/signup", {
      method: "POST",
      body: JSON.stringify({ email: "sam@studio.test", password: "password123", name: "Sam Lee" }),
    });
    const staffToken = (await staff.json()).data.accessToken as string;
    expect((await client(runtime, staffToken).fetch(`/api/v1/items/${itemJson.data.id}`)).status).toBe(404);

    const spoof = await client(runtime, staffToken).fetch("/api/v1/items", {
      method: "POST",
      body: JSON.stringify({ title: "Spoof", ownerId: created.user.id }),
    });
    expect(spoof.status).toBe(403);
    const own = await client(runtime, staffToken).fetch("/api/v1/items", {
      method: "POST",
      body: JSON.stringify({ title: "Mine" }),
    });
    expect(own.status).toBe(201);
    expect((await own.json()).data.ownerId).not.toBe(created.user.id);
    await runtime.close();
  });

  test("portable backup round trip", async () => {
    const runtime = await bootPostgres();
    const signup = await client(runtime).fetch("/api/v1/auth/signup", {
      method: "POST",
      body: JSON.stringify({ email: "ada@studio.test", password: "password123", name: "Ada West" }),
    });
    const token = (await signup.json()).data.accessToken as string;
    await client(runtime, token).fetch("/api/v1/items", { method: "POST", body: JSON.stringify({ title: "Keep me" }) });
    const dest = `${runtime.dir}/portable`;
    await exportPortable({
      dest,
      projectDir: runtime.dir,
      ast: runtime.ast,
      db: runtime.db,
      files: runtime.context.files,
    });
    await runtime.db.deleteFrom("items").execute();
    expect((await runtime.db.selectFrom("items").selectAll().execute()).length).toBe(0);
    await importPortable({ src: dest, ast: runtime.ast, db: runtime.db, files: runtime.context.files });
    expect((await runtime.db.selectFrom("items").selectAll().execute()).length).toBe(1);
    await runtime.close();
  });

  test("openapi document is generated", async () => {
    const runtime = await bootPostgres();
    const spec = await client(runtime).fetch("/api/v1/openapi.json");
    expect(spec.status).toBe(200);
    const openapi = await spec.json();
    expect(openapi.openapi).toBe("3.0.3");
    expect(openapi.paths["/api/v1/items"]).toBeTruthy();
    expect(openapi.components.securitySchemes.bearerAuth).toBeTruthy();
    await runtime.close();
  });
});
