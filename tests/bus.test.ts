import { describe, expect, test } from "bun:test";
import type { ChangeEvent } from "@bakorin/core";
import { createChangeBus } from "@bakorin/server";
import { boot, client } from "./helpers.ts";

describe("change bus", () => {
  test("subscribers receive events and can unsubscribe", () => {
    const bus = createChangeBus();
    const seen: string[] = [];
    const unsubscribe = bus.subscribe((event) => {
      seen.push(`${event.entity}.${event.op}`);
    });
    bus.emit({ entity: "leads", op: "create", before: null, after: { id: "1" }, actor: null });
    unsubscribe();
    bus.emit({ entity: "leads", op: "delete", before: { id: "1" }, after: null, actor: null });
    expect(seen).toEqual(["leads.create"]);
  });

  test("successful create update delete emit one event each with before after actor", async () => {
    const runtime = await boot();
    const events: ChangeEvent[] = [];
    runtime.context.bus.subscribe((event) => {
      events.push(event);
    });
    const signup = await client(runtime).fetch("/api/v1/auth/signup", {
      method: "POST",
      body: JSON.stringify({ email: "dev@example.com", password: "password123", name: "Dev" }),
    });
    const { accessToken, user } = (await signup.json()).data as {
      accessToken: string;
      user: { id: string; role: string };
    };
    const api = client(runtime, accessToken);

    const rejected = await api.fetch("/api/v1/items", { method: "POST", body: JSON.stringify({}) });
    expect(rejected.status).toBe(400);

    const created = await api.fetch("/api/v1/items", { method: "POST", body: JSON.stringify({ title: "Alpha" }) });
    const createdJson = await created.json();
    const id = createdJson.data.id as string;

    await api.fetch(`/api/v1/items/${id}`, { method: "PATCH", body: JSON.stringify({ done: true }) });
    await api.fetch(`/api/v1/items/${id}`, { method: "DELETE" });

    const itemEvents = events.filter((event) => event.entity === "items");
    expect(itemEvents.map((event) => event.op)).toEqual(["create", "update", "delete"]);
    expect(itemEvents[0]?.before).toBeNull();
    expect(itemEvents[0]?.after?.title).toBe("Alpha");
    expect(itemEvents[0]?.actor).toEqual({ id: user.id, role: user.role });
    expect(itemEvents[1]?.before?.title).toBe("Alpha");
    expect(itemEvents[1]?.after?.done).toBe(true);
    expect(itemEvents[2]?.before?.id).toBe(id);
    expect(itemEvents[2]?.after).toBeNull();
    await runtime.close();
  });
});
