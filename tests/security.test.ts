import { describe, expect, test } from "bun:test";
import { MINI_YAML, boot, client } from "./helpers.ts";
import { resetRateLimit } from "@bakorin/server";

const SECURE_YAML = MINI_YAML.replace(
  "      done: { type: boolean, default: false }",
  "      done: { type: boolean, default: false }\n      secretCode: { type: text, writable: admin }",
);

async function signup(runtime: Awaited<ReturnType<typeof boot>>, email: string) {
  const response = await client(runtime).fetch("/api/v1/auth/signup", {
    method: "POST",
    body: JSON.stringify({ email, password: "password123", name: email }),
  });
  const json = await response.json();
  return json.data as { accessToken: string; refreshToken: string; user: { id: string; role: string } };
}

async function promoteAdmin(runtime: Awaited<ReturnType<typeof boot>>, email: string) {
  const session = await signup(runtime, email);
  await runtime.db.updateTable("users").set({ role: "admin" }).where("id", "=", session.user.id).execute();
  const login = await client(runtime).fetch("/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password: "password123" }),
  });
  const json = await login.json();
  return json.data as { accessToken: string; refreshToken: string; user: { id: string; role: string } };
}

describe("privilege escalation guards", () => {
  test("non-admin cannot PATCH their role to admin", async () => {
    resetRateLimit();
    const runtime = await boot();
    const user = await signup(runtime, "regular@example.com");
    const patch = await client(runtime, user.accessToken).fetch(`/api/v1/users/${user.user.id}`, {
      method: "PATCH",
      body: JSON.stringify({ role: "admin" }),
    });
    expect(patch.status).toBe(403);
    const login = await client(runtime).fetch("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "regular@example.com", password: "password123" }),
    });
    const session = await login.json();
    expect(session.data.user.role).toBe("user");
    const backups = await client(runtime, session.data.accessToken as string).fetch("/api/v1/backups");
    expect(backups.status).toBe(403);
    await runtime.close();
  });

  test("public CRUD create cannot set role to admin", async () => {
    resetRateLimit();
    const runtime = await boot();
    const created = await client(runtime).fetch("/api/v1/users", {
      method: "POST",
      body: JSON.stringify({
        email: "escalated@example.com",
        password: "password123",
        name: "Nope",
        role: "admin",
      }),
    });
    expect(created.status).toBe(403);
    const withoutRole = await client(runtime).fetch("/api/v1/users", {
      method: "POST",
      body: JSON.stringify({
        email: "ok@example.com",
        password: "password123",
        name: "Ok",
      }),
    });
    expect(withoutRole.status).toBe(201);
    expect((await withoutRole.json()).data.role).toBe("user");
    const login = await client(runtime).fetch("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "ok@example.com", password: "password123" }),
    });
    const token = (await login.json()).data.accessToken as string;
    expect((await client(runtime, token).fetch("/api/v1/backups")).status).toBe(403);
    await runtime.close();
  });

  test("signup ignores a client-supplied admin role", async () => {
    resetRateLimit();
    const runtime = await boot();
    const response = await client(runtime).fetch("/api/v1/auth/signup", {
      method: "POST",
      body: JSON.stringify({ email: "sneaky@example.com", password: "password123", name: "Sneaky", role: "admin" }),
    });
    expect(response.status).toBe(201);
    expect((await response.json()).data.user.role).toBe("user");
    await runtime.close();
  });

  test("admin can set role and that revokes refresh tokens", async () => {
    resetRateLimit();
    const runtime = await boot();
    const admin = await promoteAdmin(runtime, "boss@example.com");
    const user = await signup(runtime, "staff@example.com");
    const patch = await client(runtime, admin.accessToken).fetch(`/api/v1/users/${user.user.id}`, {
      method: "PATCH",
      body: JSON.stringify({ role: "admin" }),
    });
    expect(patch.status).toBe(200);
    expect((await patch.json()).data.role).toBe("admin");
    const stale = await client(runtime).fetch("/api/v1/auth/refresh", {
      method: "POST",
      body: JSON.stringify({ refreshToken: user.refreshToken }),
    });
    expect(stale.status).toBe(401);
    await runtime.close();
  });

  test("password CRUD update requires currentPassword for self and always hashes", async () => {
    resetRateLimit();
    const runtime = await boot();
    const user = await signup(runtime, "pwd@example.com");
    const missing = await client(runtime, user.accessToken).fetch(`/api/v1/users/${user.user.id}`, {
      method: "PATCH",
      body: JSON.stringify({ password: "new-password-1" }),
    });
    expect(missing.status).toBe(400);
    const ok = await client(runtime, user.accessToken).fetch(`/api/v1/users/${user.user.id}`, {
      method: "PATCH",
      body: JSON.stringify({ password: "new-password-1", currentPassword: "password123" }),
    });
    expect(ok.status).toBe(200);
    const row = await runtime.db.selectFrom("users").selectAll().where("id", "=", user.user.id).executeTakeFirstOrThrow();
    expect(String(row.password)).not.toBe("new-password-1");
    expect(String(row.password).startsWith("$")).toBe(true);
    const stale = await client(runtime).fetch("/api/v1/auth/refresh", {
      method: "POST",
      body: JSON.stringify({ refreshToken: user.refreshToken }),
    });
    expect(stale.status).toBe(401);
    const login = await client(runtime).fetch("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "pwd@example.com", password: "new-password-1" }),
    });
    expect(login.status).toBe(200);
    await runtime.close();
  });

  test("admin can set another user's password without currentPassword", async () => {
    resetRateLimit();
    const runtime = await boot();
    const admin = await promoteAdmin(runtime, "resetter@example.com");
    const user = await signup(runtime, "target@example.com");
    const patch = await client(runtime, admin.accessToken).fetch(`/api/v1/users/${user.user.id}`, {
      method: "PATCH",
      body: JSON.stringify({ password: "admin-set-99" }),
    });
    expect(patch.status).toBe(200);
    const login = await client(runtime).fetch("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "target@example.com", password: "admin-set-99" }),
    });
    expect(login.status).toBe(200);
    await runtime.close();
  });

  test("writable admin fields and owner rows cannot be taken over", async () => {
    resetRateLimit();
    const runtime = await boot(SECURE_YAML);
    const alice = await signup(runtime, "alice@example.com");
    const bob = await signup(runtime, "bob@example.com");
    const forbidden = await client(runtime, alice.accessToken).fetch("/api/v1/items", {
      method: "POST",
      body: JSON.stringify({ title: "locked", secretCode: "alpha" }),
    });
    expect(forbidden.status).toBe(403);
    const created = await client(runtime, alice.accessToken).fetch("/api/v1/items", {
      method: "POST",
      body: JSON.stringify({ title: "locked" }),
    });
    expect(created.status).toBe(201);
    const otherUser = await client(runtime, alice.accessToken).fetch(`/api/v1/users/${bob.user.id}`, {
      method: "PATCH",
      body: JSON.stringify({ name: "Hijacked" }),
    });
    expect(otherUser.status).toBe(404);
    const admin = await promoteAdmin(runtime, "coder@example.com");
    const withCode = await client(runtime, admin.accessToken).fetch("/api/v1/items", {
      method: "POST",
      body: JSON.stringify({ title: "admin-item", secretCode: "alpha", ownerId: alice.user.id }),
    });
    expect(withCode.status).toBe(201);
    expect((await withCode.json()).data.secretCode).toBe("alpha");
    await runtime.close();
  });
});
