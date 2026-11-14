import { describe, expect, test } from "bun:test";
import { boot, client } from "./helpers.ts";

async function signup(runtime: Awaited<ReturnType<typeof boot>>, email: string, role?: string) {
  const body: Record<string, unknown> = { email, password: "password123", name: email };
  if (role) {
    body.role = role;
  }
  const response = await client(runtime).fetch("/api/v1/auth/signup", { method: "POST", body: JSON.stringify(body) });
  const json = await response.json();
  return json.data as { accessToken: string; user: { id: string; role: string } };
}

describe("policies to SQL", () => {
  test("owner policy hides other users rows and ignores spoofed ownerId", async () => {
    const runtime = await boot();
    const alice = await signup(runtime, "alice@example.com");
    const bob = await signup(runtime, "bob@example.com");
    const aliceApi = client(runtime, alice.accessToken);
    const bobApi = client(runtime, bob.accessToken);

    const created = await aliceApi.fetch("/api/v1/items", {
      method: "POST",
      body: JSON.stringify({ title: "secret", ownerId: bob.user.id }),
    });
    expect(created.status).toBe(201);
    const createdJson = await created.json();
    expect(createdJson.data.ownerId).toBe(alice.user.id);

    const bobList = await bobApi.fetch("/api/v1/items");
    const bobJson = await bobList.json();
    expect(bobJson.data).toEqual([]);

    const bobGet = await bobApi.fetch(`/api/v1/items/${createdJson.data.id}`);
    expect(bobGet.status).toBe(404);

    const bobPatch = await bobApi.fetch(`/api/v1/items/${createdJson.data.id}`, {
      method: "PATCH",
      body: JSON.stringify({ title: "hijack" }),
    });
    expect(bobPatch.status).toBe(404);

    const aliceList = await aliceApi.fetch("/api/v1/items");
    expect((await aliceList.json()).data).toHaveLength(1);

    const anon = await client(runtime).fetch("/api/v1/items");
    expect(anon.status).toBe(401);

    await runtime.close();
  });

  test("admin bypasses owner filters", async () => {
    const runtime = await boot();
    const alice = await signup(runtime, "alice@example.com");
    await client(runtime, alice.accessToken).fetch("/api/v1/items", {
      method: "POST",
      body: JSON.stringify({ title: "only-alice" }),
    });
    const admin = await signup(runtime, "owner@example.com");
    await runtime.db.updateTable("users").set({ role: "admin" }).where("id", "=", admin.user.id).execute();
    const login = await client(runtime).fetch("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "owner@example.com", password: "password123" }),
    });
    const token = (await login.json()).data.accessToken as string;
    const list = await client(runtime, token).fetch("/api/v1/items");
    expect((await list.json()).data.length).toBe(1);
    await runtime.close();
  });
});
