// Realtime: server sent events with per reader policy filtering, resume, limits,
// auth revalidation, drain, and metrics. Runs on SQLite, and on Postgres in the CI
// matrix (where the broker is LISTEN/NOTIFY).
import { afterEach, describe, expect, test } from "bun:test";
import { createRuntime } from "@bakorin/server";
import { boot, MINI_YAML, TEST_DIALECT } from "./helpers.ts";
import { sseReader } from "./realtime-helpers.ts";

const cleanups: Array<() => Promise<unknown> | unknown> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

type Runtime = Awaited<ReturnType<typeof boot>>;

const RT_YAML = MINI_YAML.replace(
  "      ownerId: { type: relation, to: users, required: true }\n    policies:\n      read: owner(ownerId)",
  "      ownerId: { type: relation, to: users, required: true }\n    realtime: true\n    policies:\n      read: owner(ownerId)",
).replace(
  "entities:\n",
  `entities:
  notices:
    realtime: ids
    fields:
      body: { type: text, required: true }
    policies:
      read: public
      create: admin
      update: admin
      delete: admin
  posts:
    realtime: true
    fields:
      body: { type: text, required: true }
      draftNote: { type: text, private: true }
    policies:
      read: public
      create: authenticated
      update: admin
      delete: admin
`,
);

function withRuntime(extra: string, base = RT_YAML): string {
  return base.replace("  hooks: ./hooks.ts\n", `  hooks: ./hooks.ts\n${extra}`);
}

async function started(yaml = RT_YAML): Promise<Runtime> {
  const runtime = await boot(yaml);
  cleanups.push(() => runtime.close());
  return runtime;
}

async function call(runtime: Runtime, method: string, path: string, body?: unknown, token?: string, headers: Record<string, string> = {}) {
  const res = await runtime.app.request(path, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

async function user(runtime: Runtime, email: string) {
  await call(runtime, "POST", "/api/v1/auth/signup", { email, password: "password123", name: email.split("@")[0] });
  const login = await call(runtime, "POST", "/api/v1/auth/login", { email, password: "password123" });
  return { id: login.json.data.user.id as string, token: login.json.data.accessToken as string, refresh: login.json.data.refreshToken as string };
}

async function admin(runtime: Runtime) {
  const res = await call(runtime, "POST", "/api/v1/auth/first-admin", { email: "boss@example.test", password: "password123", name: "Boss" });
  return { id: res.json.data.user.id as string, token: res.json.data.accessToken as string };
}

async function stream(runtime: Runtime, entities: string, token?: string, headers: Record<string, string> = {}) {
  const res = await runtime.app.request(`/api/v1/realtime?entities=${entities}`, {
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
  });
  if (res.status !== 200) {
    return { status: res.status, json: await res.json(), sse: null };
  }
  const sse = sseReader(res);
  cleanups.push(() => sse.cancel());
  await sse.next((event) => event.event === "ready");
  return { status: 200, json: null, sse };
}

describe("realtime: config and access", () => {
  test("off by default: entities without realtime answer 404", async () => {
    const runtime = await started(MINI_YAML);
    const boss = await admin(runtime);
    const res = await stream(runtime, "items", boss.token);
    expect(res.status).toBe(404);
    expect(res.json.error.code).toBe("not_realtime");
  });

  test("realtime: true, ids, and a bad broker compile as expected", async () => {
    const runtime = await started();
    expect(runtime.ast.entityMap.items!.realtime).toBe("full");
    expect(runtime.ast.entityMap.notices!.realtime).toBe("ids");
    expect(runtime.ast.entityMap.users!.realtime).toBeUndefined();
    expect(runtime.ast.runtime.realtime.broker).toBe("auto");
    const { compileAppYaml } = await import("@bakorin/core");
    expect(() => compileAppYaml(withRuntime("  realtime:\n    broker: postgres\n", MINI_YAML))).toThrow(/dialect postgres/);
  });

  test("owner only entities need a token and a missing entity is 404", async () => {
    const runtime = await started();
    expect((await stream(runtime, "items")).status).toBe(401);
    expect((await stream(runtime, "nope")).status).toBe(404);
    expect((await stream(runtime, "")).status).toBe(400);
  });
});

describe("realtime: per reader filtering", () => {
  test("owners see their own changes, others see nothing, admins see all", async () => {
    const runtime = await started();
    const boss = await admin(runtime);
    const a = await user(runtime, "ada@example.test");
    const b = await user(runtime, "bo@example.test");
    const sa = (await stream(runtime, "items", a.token)).sse!;
    const sb = (await stream(runtime, "items", b.token)).sse!;
    const sx = (await stream(runtime, "items", boss.token)).sse!;
    const created = await call(runtime, "POST", "/api/v1/items", { title: "Sample task" }, a.token);
    expect(created.status).toBe(201);
    const id = created.json.data.id;
    const got = await sa.next((event) => event.event === "change");
    expect(got.data).toMatchObject({ entity: "items", op: "create", id, record: { title: "Sample task", ownerId: a.id } });
    expect(Number(got.id)).toBeGreaterThan(0);
    expect((await sx.next((event) => event.event === "change")).data.id).toBe(id);
    await call(runtime, "PATCH", `/api/v1/items/${id}`, { done: true }, a.token);
    expect((await sa.next((event) => event.data?.op === "update")).data.record.done).toBe(true);
    await call(runtime, "DELETE", `/api/v1/items/${id}`, undefined, a.token);
    const deleted = await sa.next((event) => event.data?.op === "delete");
    expect(deleted.data.record).toBeUndefined();
    await Bun.sleep(100);
    expect(sb.changes()).toEqual([]);
  });

  test("moving a record to another owner tells the old owner it is gone", async () => {
    const runtime = await started();
    const boss = await admin(runtime);
    const a = await user(runtime, "ada@example.test");
    const b = await user(runtime, "bo@example.test");
    const id = (await call(runtime, "POST", "/api/v1/items", { title: "Hand over" }, a.token)).json.data.id;
    const sa = (await stream(runtime, "items", a.token)).sse!;
    const sb = (await stream(runtime, "items", b.token)).sse!;
    expect((await call(runtime, "PATCH", `/api/v1/items/${id}`, { ownerId: b.id }, boss.token)).status).toBe(200);
    // The create can still reach a stream opened just after it (the hub had not pumped it yet), so wait for the op.
    expect((await sa.next((event) => event.event === "change" && event.data?.op !== "create")).data).toMatchObject({ op: "delete", id });
    expect((await sb.next((event) => event.event === "change" && event.data?.op !== "create")).data).toMatchObject({ op: "update", id, record: { ownerId: b.id } });
  });

  test("public entities reach signed out readers, private fields stay private, ids mode sends no record", async () => {
    const runtime = await started();
    const boss = await admin(runtime);
    const anon = (await stream(runtime, "posts,notices")).sse!;
    const staff = (await stream(runtime, "posts", boss.token)).sse!;
    await call(runtime, "POST", "/api/v1/posts", { body: "Hello from the sample app", draftNote: "internal" }, boss.token);
    const post = await anon.next((event) => event.data?.entity === "posts");
    expect(post.data.record.body).toBe("Hello from the sample app");
    expect(post.data.record.draftNote).toBeUndefined();
    expect((await staff.next((event) => event.data?.entity === "posts")).data.record.draftNote).toBe("internal");
    await call(runtime, "POST", "/api/v1/notices", { body: "Maintenance tonight" }, boss.token);
    const notice = await anon.next((event) => event.data?.entity === "notices");
    expect(notice.data.op).toBe("create");
    expect(notice.data.record).toBeUndefined();
    // One frame serialized for every signed out reader of the public post.
    const stats = runtime.context.realtime!.stats();
    expect(stats.framesBuiltTotal).toBeLessThan(stats.deliveriesTotal + 2);
  });

  test("subscribers with the same policy context share one frame", async () => {
    const runtime = await started();
    const boss = await admin(runtime);
    const readers = [];
    for (let i = 0; i < 20; i++) readers.push((await stream(runtime, "posts")).sse!);
    const before = runtime.context.realtime!.stats().framesBuiltTotal;
    await call(runtime, "POST", "/api/v1/posts", { body: "Shared" }, boss.token);
    for (const reader of readers) await reader.next((event) => event.event === "change");
    const stats = runtime.context.realtime!.stats();
    expect(stats.framesBuiltTotal - before).toBe(1);
  });

  test("a write that rolls back publishes nothing", async () => {
    const yaml = RT_YAML.replace("      body: { type: text, required: true }\n      draftNote", "      body: { type: text, required: true, unique: true }\n      draftNote");
    const runtime = await started(yaml);
    const boss = await admin(runtime);
    const anon = (await stream(runtime, "posts")).sse!;
    expect((await call(runtime, "POST", "/api/v1/posts", { body: "once" }, boss.token)).status).toBe(201);
    expect((await call(runtime, "POST", "/api/v1/posts", { body: "once" }, boss.token)).status).toBe(409);
    await anon.next((event) => event.event === "change");
    await Bun.sleep(150);
    expect(anon.changes().length).toBe(1);
  });
});

describe("realtime: resume and reliability", () => {
  test("Last-Event-ID replays what was missed, in order, without duplicates", async () => {
    const runtime = await started();
    const boss = await admin(runtime);
    const first = (await stream(runtime, "posts")).sse!;
    await call(runtime, "POST", "/api/v1/posts", { body: "one" }, boss.token);
    const seen = await first.next((event) => event.event === "change");
    first.cancel();
    await call(runtime, "POST", "/api/v1/posts", { body: "two" }, boss.token);
    await call(runtime, "POST", "/api/v1/posts", { body: "three" }, boss.token);
    await runtime.context.realtime!.pump();
    const again = (await stream(runtime, "posts", undefined, { "last-event-id": seen.id! })).sse!;
    await call(runtime, "POST", "/api/v1/posts", { body: "four" }, boss.token);
    await again.next((event) => event.data?.record?.body === "four");
    expect(again.changes().map((event) => event.data.record.body)).toEqual(["two", "three", "four"]);
    const ids = again.changes().map((event) => Number(event.id));
    expect(ids).toEqual([...ids].sort((x, y) => x - y));
  });

  test("resume from the database log after the memory buffer, and reset when too far behind", async () => {
    const runtime = await started(withRuntime("  realtime:\n    replayEvents: 2\n"));
    const boss = await admin(runtime);
    const probe = (await stream(runtime, "posts")).sse!;
    await call(runtime, "POST", "/api/v1/posts", { body: "a" }, boss.token);
    const mark = Number((await probe.next((event) => event.event === "change")).id);
    for (const body of ["b", "c"]) await call(runtime, "POST", "/api/v1/posts", { body }, boss.token);
    await probe.next((event) => event.data?.record?.body === "c");
    const fromLog = (await stream(runtime, "posts", undefined, { "last-event-id": String(mark) })).sse!;
    await fromLog.next((event) => event.data?.record?.body === "c");
    expect(fromLog.changes().map((event) => event.data.record.body)).toEqual(["b", "c"]);
    // Three missed events with room for two: the client is told to refetch.
    const tooFar = (await stream(runtime, "posts", undefined, { "last-event-id": "0" })).sse!;
    expect(tooFar.events.some((event) => event.event === "reset")).toBe(true);
    expect(tooFar.changes()).toEqual([]);
    expect(runtime.context.realtime!.stats().resetsTotal).toBe(1);
  });

  test("per user and global connection caps", async () => {
    const runtime = await started(withRuntime("  realtime:\n    maxPerUser: 2\n    maxConnections: 3\n"));
    const a = await user(runtime, "ada@example.test");
    const b = await user(runtime, "bo@example.test");
    expect((await stream(runtime, "items", a.token)).status).toBe(200);
    expect((await stream(runtime, "items", a.token)).status).toBe(200);
    const third = await stream(runtime, "items", a.token);
    expect(third.status).toBe(429);
    expect((await stream(runtime, "items", b.token)).status).toBe(200);
    const full = await stream(runtime, "posts");
    expect(full.status).toBe(503);
    expect(runtime.context.realtime!.stats().rejectedTotal).toMatchObject({ user_limit: 1, server_full: 1 });
  });

  test("a client that stops reading is dropped instead of buffering forever", async () => {
    const runtime = await started(withRuntime("  realtime:\n    maxBufferKb: 4\n"));
    const boss = await admin(runtime);
    const res = await runtime.app.request("/api/v1/realtime?entities=posts");
    expect(res.status).toBe(200);
    // Never read the body.
    for (let i = 0; i < 20; i++) {
      await call(runtime, "POST", "/api/v1/posts", { body: "x".repeat(500) + i }, boss.token);
    }
    await runtime.context.realtime!.pump();
    const stats = runtime.context.realtime!.stats();
    expect(stats.droppedSlowTotal).toBe(1);
    expect(stats.connections).toBe(0);
    void res.body?.cancel().catch(() => undefined);
  });
});

describe("realtime: auth revalidation and shutdown", () => {
  test("logout everywhere, logout on one device, and a role change close the right streams", async () => {
    const runtime = await started();
    const boss = await admin(runtime);
    const a = await user(runtime, "ada@example.test");
    const b = await user(runtime, "bo@example.test");
    const sa = (await stream(runtime, "items", a.token)).sse!;
    await call(runtime, "POST", "/api/v1/auth/logout", { all: true }, a.token);
    expect((await sa.next((event) => event.event === "closed")).data.reason).toBe("signed_out");
    expect(await sa.ended()).toBe(true);

    const b2 = await call(runtime, "POST", "/api/v1/auth/login", { email: "bo@example.test", password: "password123" });
    const device1 = (await stream(runtime, "items", b.token)).sse!;
    const device2 = (await stream(runtime, "items", b2.json.data.accessToken)).sse!;
    await call(runtime, "POST", "/api/v1/auth/logout", { refreshToken: b.refresh }, b.token);
    expect((await device1.next((event) => event.event === "closed")).data.reason).toBe("logged_out");
    await Bun.sleep(100);
    expect(device2.done).toBe(false);

    const users = await call(runtime, "GET", "/api/v1/users", undefined, boss.token);
    const bRow = users.json.data.find((row: { email: string }) => row.email === "bo@example.test");
    await call(runtime, "PATCH", `/api/v1/users/${bRow.id}`, { role: "admin" }, boss.token);
    expect((await device2.next((event) => event.event === "closed")).data.reason).toMatch(/role_changed|signed_out/);
  });

  test("streams close when the access token expires", async () => {
    const yaml = RT_YAML.replace("    secret: test-jwt-secret-0123456789-abcdefghijklmnop\n", "    secret: test-jwt-secret-0123456789-abcdefghijklmnop\n    accessTtlSeconds: 1\n");
    const runtime = await started(yaml);
    const a = await user(runtime, "ada@example.test");
    const sa = (await stream(runtime, "items", a.token)).sse!;
    expect((await sa.next((event) => event.event === "closed", 4000)).data.reason).toBe("token_expired");
  });

  test("drain asks every stream to reconnect with a spread out retry and refuses new ones", async () => {
    const runtime = await started();
    const s1 = (await stream(runtime, "posts")).sse!;
    await runtime.context.realtime!.drain();
    const closed = await s1.next((event) => event.event === "closed");
    expect(closed.data.reason).toBe("server_restart");
    expect(closed.retry).toBeGreaterThanOrEqual(1000);
    expect(closed.retry).toBeLessThanOrEqual(5000);
    const refused = await stream(runtime, "posts");
    expect(refused.status).toBe(503);
  });

  test("metrics and the Status page report connections and events", async () => {
    const runtime = await started();
    const boss = await admin(runtime);
    const anon = (await stream(runtime, "posts")).sse!;
    await call(runtime, "POST", "/api/v1/posts", { body: "m" }, boss.token);
    await anon.next((event) => event.event === "change");
    const status = await call(runtime, "GET", "/api/v1/status", undefined, boss.token);
    expect(status.json.data.realtime).toMatchObject({ enabled: true, connections: 1, broker: TEST_DIALECT === "postgres" ? "postgres" : "memory" });
    expect(status.json.data.realtime.entities.map((entity: { name: string }) => entity.name).sort()).toEqual(["items", "notices", "posts"]);
    const { collectStatus, metricsExtrasForTest } = await import("../packages/server/src/monitor/status.ts").then((mod) => ({
      collectStatus: mod.collectStatus,
      metricsExtrasForTest: mod.metricsExtras,
    }));
    expect(collectStatus).toBeDefined();
    const lines = (await metricsExtrasForTest(runtime.context, runtime.context.monitor)).join("\n");
    expect(lines).toContain("bakorin_realtime_connections 1");
    expect(lines).toMatch(/bakorin_realtime_deliveries_total [1-9]/);
  });
});

describe.skipIf(TEST_DIALECT !== "postgres")("realtime: multiple instances over Postgres LISTEN/NOTIFY", () => {
  test("a write on one instance reaches subscribers on another, and resume works across them", async () => {
    const one = await started();
    const two = await createRuntime({ projectDir: one.dir, yamlSource: await Bun.file(`${one.dir}/app.yaml`).text(), workers: false });
    cleanups.push(() => two.close());
    const boss = await admin(one);
    const remote = (await stream(two as Runtime, "posts")).sse!;
    expect(two.context.realtime!.stats().broker).toBe("postgres");
    const started2 = Date.now();
    await call(one, "POST", "/api/v1/posts", { body: "across instances" }, boss.token);
    const got = await remote.next((event) => event.event === "change", 5000);
    expect(got.data.record.body).toBe("across instances");
    expect(Date.now() - started2).toBeLessThan(2000);
    remote.cancel();
    await call(one, "POST", "/api/v1/posts", { body: "missed" }, boss.token);
    await Bun.sleep(300);
    const resumed = (await stream(one, "posts", undefined, { "last-event-id": got.id! })).sse!;
    await resumed.next((event) => event.data?.record?.body === "missed", 5000);
  });

  test("a logout on one instance closes the stream on the other", async () => {
    const one = await started();
    const two = await createRuntime({ projectDir: one.dir, yamlSource: await Bun.file(`${one.dir}/app.yaml`).text(), workers: false });
    cleanups.push(() => two.close());
    const a = await user(one, "ada@example.test");
    const remote = (await stream(two as Runtime, "items", a.token)).sse!;
    await call(one, "POST", "/api/v1/auth/logout", { all: true }, a.token);
    expect((await remote.next((event) => event.event === "closed", 5000)).data.reason).toBe("signed_out");
  });
});

describe.skipIf(TEST_DIALECT !== "postgres")("realtime: Postgres broker", () => {
  test("NOTIFY reaches a second broker directly, not only through the safety poll", async () => {
    const runtime = await started();
    const { createPostgresBroker } = await import("../packages/server/src/realtime/broker.ts");
    const url = runtime.ast.runtime.postgresUrl!;
    const a = createPostgresBroker({ url, db: runtime.db });
    const b = createPostgresBroker({ url, db: runtime.db });
    cleanups.push(() => a.close(), () => b.close());
    const got: unknown[] = [];
    b.subscribe((message) => got.push(message));
    for (let i = 0; i < 50 && !(a.healthy() && b.healthy()); i++) await Bun.sleep(20);
    const sentAt = Date.now();
    await a.publish({ kind: "user", userId: "u1", origin: "test" });
    for (let i = 0; i < 100 && got.length === 0; i++) await Bun.sleep(5);
    expect(got).toEqual([{ kind: "user", userId: "u1", origin: "test" }]);
    expect(Date.now() - sentAt).toBeLessThan(500);
  });
});

describe("realtime: ordering", () => {
  test("a missing id is waited for, then skipped as rolled back", async () => {
    const runtime = await started();
    const { createRealtimeHub } = await import("../packages/server/src/realtime/hub.ts");
    const { createMemoryBroker } = await import("../packages/server/src/realtime/broker.ts");
    const { REALTIME_TABLE } = await import("../packages/server/src/db/system.ts");
    const hub = createRealtimeHub({ ast: () => runtime.ast, db: runtime.db, bus: runtime.context.bus, broker: createMemoryBroker(), gapWaitMs: 300 });
    cleanups.push(() => hub.close());
    await hub.start();
    const base = hub.stats().cursor;
    const res = await hub.connect({ actor: null, ip: "t", entities: ["posts"] });
    const sse = sseReader(res);
    cleanups.push(() => sse.cancel());
    await sse.next((event) => event.event === "ready");
    const row = (seq: number, body: string) => ({
      seq,
      entity: "posts",
      op: "create",
      record_id: `p${seq}`,
      data: JSON.stringify({ before: null, after: { id: `p${seq}`, body } }),
      at: Date.now(),
    });
    await runtime.db.insertInto(REALTIME_TABLE).values(row(base + 1, "first")).execute();
    await runtime.db.insertInto(REALTIME_TABLE).values(row(base + 3, "third")).execute();
    const started2 = Date.now();
    await hub.pump();
    await sse.next((event) => event.data?.record?.body === "first");
    expect(sse.changes().length).toBe(1);
    // A late commit of the missing id inside the wait is delivered in order.
    await runtime.db.insertInto(REALTIME_TABLE).values(row(base + 2, "second")).execute();
    await sse.next((event) => event.data?.record?.body === "third", 2000);
    expect(sse.changes().map((event) => event.data.record.body)).toEqual(["first", "second", "third"]);
    await runtime.db.insertInto(REALTIME_TABLE).values(row(base + 5, "fifth")).execute();
    await hub.pump();
    await sse.next((event) => event.data?.record?.body === "fifth", 2000);
    expect(Date.now() - started2).toBeGreaterThanOrEqual(300);
  });
});
