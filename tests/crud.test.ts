import { describe, expect, test } from "bun:test";
import { boot, client } from "./helpers.ts";

describe("crud", () => {
  test("list filter sort expand create update delete", async () => {
    const runtime = await boot();
    const signup = await client(runtime).fetch("/api/v1/auth/signup", {
      method: "POST",
      body: JSON.stringify({ email: "dev@example.com", password: "password123", name: "Dev" }),
    });
    const { accessToken, user } = (await signup.json()).data;
    const api = client(runtime, accessToken);

    const a = await api.fetch("/api/v1/items", { method: "POST", body: JSON.stringify({ title: "Alpha" }) });
    const b = await api.fetch("/api/v1/items", { method: "POST", body: JSON.stringify({ title: "Beta", done: true }) });
    expect(a.status).toBe(201);
    expect((await b.json()).data.ownerId).toBe(user.id);

    const listed = await api.fetch("/api/v1/items?sort=title&filter[title][like]=Alp");
    const listedJson = await listed.json();
    expect(listedJson.data).toHaveLength(1);
    expect(listedJson.data[0].title).toBe("Alpha");

    const expanded = await api.fetch(`/api/v1/items/${listedJson.data[0].id}?expand=ownerId`);
    const expandedJson = await expanded.json();
    expect(expandedJson.data.$expand.ownerId.email).toBe("dev@example.com");
    expect(expandedJson.data.$expand.ownerId.name).toBe("Dev");
    expect(expandedJson.data.$expand.ownerId.password).toBeUndefined();

    const patched = await api.fetch(`/api/v1/items/${listedJson.data[0].id}`, {
      method: "PATCH",
      body: JSON.stringify({ done: true }),
    });
    expect((await patched.json()).data.done).toBe(true);

    const deleted = await api.fetch(`/api/v1/items/${listedJson.data[0].id}`, { method: "DELETE" });
    expect(deleted.status).toBe(200);
    const after = await api.fetch("/api/v1/items");
    expect((await after.json()).data).toHaveLength(1);

    await runtime.close();
  });

  test("after hooks run from the change bus", async () => {
    const runtime = await boot(
      undefined,
      `
      const seen = [];
      export default {
        seenEvents: seen,
        entities: {
          items: {
            afterCreate({ record }) { seen.push(record.title); }
          }
        }
      };
      `,
    );
    const signup = await client(runtime).fetch("/api/v1/auth/signup", {
      method: "POST",
      body: JSON.stringify({ email: "dev@example.com", password: "password123", name: "Dev" }),
    });
    const token = (await signup.json()).data.accessToken as string;
    await client(runtime, token).fetch("/api/v1/items", { method: "POST", body: JSON.stringify({ title: "Hooked" }) });
    await Bun.sleep(40);
    const hooks = runtime.context.hooks as { entities?: { items?: { afterCreate?: unknown } }; seenEvents?: string[] };
    expect(hooks.entities?.items?.afterCreate).toBeTypeOf("function");
    expect(hooks.seenEvents).toEqual(["Hooked"]);
    await runtime.close();
  });
});
