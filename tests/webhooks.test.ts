import { describe, expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { createHmac, timingSafeEqual } from "node:crypto";
import { compileAppYaml } from "@bakorin/core";
import {
  cleanupDelivered,
  createRuntime,
  redactChangeEvent,
  signWebhookPayload,
} from "@bakorin/server";
import { WEBHOOK_OUTBOX_TABLE } from "../packages/server/src/db/system.ts";
import { boot, client, MINI_YAML, tempProject } from "./helpers.ts";

interface Hit {
  body: string;
  headers: Record<string, string>;
  status: number;
}

function startReceiver(options: { status?: number; delayMs?: number } = {}) {
  const hits: Hit[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      if (options.delayMs) {
        await Bun.sleep(options.delayMs);
      }
      const body = await request.text();
      const headers: Record<string, string> = {};
      request.headers.forEach((value, key) => {
        headers[key.toLowerCase()] = value;
      });
      hits.push({ body, headers, status: options.status ?? 200 });
      return new Response(options.status && options.status >= 400 ? "nope" : "ok", {
        status: options.status ?? 200,
      });
    },
  });
  return {
    url: `http://127.0.0.1:${server.port}/hook`,
    hits,
    stop: () => server.stop(true),
  };
}

function yamlFor(url: string, extra = ""): string {
  return `${MINI_YAML}
webhooks:
  - entity: users
    events: [create]
    url: ${url}
    secret: webhook-secret-webhook-secret
${extra}
`;
}

async function waitFor<T>(label: string, fn: () => T | undefined | Promise<T | undefined>, timeoutMs = 5000): Promise<T> {
  const start = Date.now();
  let last: T | undefined;
  while (Date.now() - start < timeoutMs) {
    last = await fn();
    if (last) {
      return last;
    }
    await Bun.sleep(40);
  }
  throw new Error(`${label} timed out`);
}

async function signInAdmin(runtime: Awaited<ReturnType<typeof boot>>, email: string) {
  const api = client(runtime);
  const signup = await api.fetch("/api/v1/auth/signup", {
    method: "POST",
    body: JSON.stringify({ email, password: "password123", name: "Admin" }),
  });
  expect(signup.status).toBe(201);
  const user = (await signup.json()).data.user as { id: string };
  await runtime.db.updateTable("users").set({ role: "admin" }).where("id", "=", user.id).execute();
  const login = await api.fetch("/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password: "password123" }),
  });
  expect(login.status).toBe(200);
  return client(runtime, (await login.json()).data.accessToken as string);
}

describe("webhooks", () => {
  test("users-entity webhook never contains password hashes and signs timestamp plus body", async () => {
    const receiver = startReceiver();
    const busEvents: Array<Record<string, unknown>> = [];
    try {
      const runtime = await boot(
        yamlFor(
          receiver.url,
          `    maxAttempts: 3
    timeoutMs: 2000
`,
        ),
      );
      runtime.context.bus.subscribe((event) => {
        if (event.entity === "users") {
          busEvents.push(event.after ?? {});
        }
      });
      const signup = await client(runtime).fetch("/api/v1/auth/signup", {
        method: "POST",
        body: JSON.stringify({ email: "ada@example.com", password: "password123", name: "Ada" }),
      });
      expect(signup.status).toBe(201);
      const hit = await waitFor("webhook POST", () => receiver.hits[0]);
      const payload = JSON.parse(hit.body) as {
        entity: string;
        after: Record<string, unknown>;
        before: unknown;
        actor: unknown;
      };
      expect(payload.entity).toBe("users");
      expect(payload.after.email).toBe("ada@example.com");
      expect(payload.after.password).toBeUndefined();
      expect(JSON.stringify(payload)).not.toContain("argon2");
      expect(JSON.stringify(payload)).not.toMatch(/\$argon2/i);
      expect(hit.body).not.toContain("password123");

      const outbox = await runtime.db.selectFrom(WEBHOOK_OUTBOX_TABLE).selectAll().execute();
      expect(outbox).toHaveLength(1);
      expect(String(outbox[0]?.payload)).not.toContain("argon2");
      expect(String(outbox[0]?.status)).toBe("delivered");

      const timestamp = hit.headers["x-bakorin-timestamp"] ?? "";
      const delivery = hit.headers["x-bakorin-delivery"] ?? "";
      const signature = hit.headers["x-bakorin-signature"] ?? "";
      expect(delivery).toMatch(/^[0-9a-f-]{36}$/i);
      expect(Date.parse(timestamp)).toBeGreaterThan(0);
      const expected = `sha256=${signWebhookPayload("webhook-secret-webhook-secret", timestamp, hit.body)}`;
      const a = Buffer.from(expected);
      const b = Buffer.from(signature);
      expect(a.length).toBe(b.length);
      expect(timingSafeEqual(a, b)).toBe(true);
      const digest = createHmac("sha256", "webhook-secret-webhook-secret").update(hit.body).digest("hex");
      expect(signature).not.toBe(`sha256=${digest}`);

      const storedUser = busEvents.find((row) => row.email === "ada@example.com");
      expect(typeof storedUser?.password).toBe("string");
      expect(String(storedUser?.password)).toContain("argon2");
      const ast = compileAppYaml(await Bun.file(join(runtime.dir, "app.yaml")).text(), {
        env: { JWT_SECRET: "test-jwt-secret-0123456789-abcdefghijklmnop" },
      });
      const redacted = redactChangeEvent(ast, {
        entity: "users",
        op: "create",
        before: null,
        after: storedUser as Record<string, unknown>,
        actor: { id: "x", role: "user" },
      });
      expect(redacted.after?.password).toBeUndefined();

      await runtime.close();
    } finally {
      receiver.stop();
    }
  });

  test("failed deliveries stop after maxAttempts and admin retry sends again", async () => {
    const receiver = startReceiver({ status: 500 });
    try {
      const runtime = await boot(
        yamlFor(
          receiver.url,
          `    maxAttempts: 1
    timeoutMs: 500
`,
        ),
      );
      const admin = await signInAdmin(runtime, "ops@example.com");
      const row = await waitFor("failed outbox", async () => {
        const listed = await admin.fetch("/api/v1/webhooks/deliveries?status=failed");
        const json = (await listed.json()) as { data: Array<{ id: string; status: string; attempts: number; lastStatusCode: number }> };
        return json.data[0];
      });
      expect(row.status).toBe("failed");
      expect(row.attempts).toBe(1);
      expect(row.lastStatusCode).toBe(500);
      const hitsAfterFail = receiver.hits.length;
      await Bun.sleep(1200);
      expect(receiver.hits.length).toBe(hitsAfterFail);

      const forbidden = await client(runtime).fetch("/api/v1/webhooks");
      expect(forbidden.status).toBe(401);
      const userSignup = await client(runtime).fetch("/api/v1/auth/signup", {
        method: "POST",
        body: JSON.stringify({ email: "member@example.com", password: "password123", name: "Member" }),
      });
      const memberToken = (await userSignup.json()).data.accessToken as string;
      const asMember = await client(runtime, memberToken).fetch("/api/v1/webhooks/deliveries");
      expect(asMember.status).toBe(403);

      const retry = await admin.fetch(`/api/v1/webhooks/deliveries/${row.id}/retry`, { method: "POST" });
      expect(retry.status).toBe(200);
      await waitFor("retry hit", () => receiver.hits.length > hitsAfterFail);
      await runtime.close();
    } finally {
      receiver.stop();
    }
  });

  test("timeout is recorded and test event is admin-only", async () => {
    const receiver = startReceiver({ delayMs: 800 });
    try {
      const runtime = await boot(
        yamlFor(
          receiver.url,
          `    maxAttempts: 1
    timeoutMs: 100
`,
        ),
      );
      const admin = await signInAdmin(runtime, "timeout@example.com");
      const hooks = await admin.fetch("/api/v1/webhooks");
      const configured = (await hooks.json()).data as Array<{ id: string; urlHost: string }>;
      expect(configured[0]?.urlHost).toContain("127.0.0.1");
      expect(JSON.stringify(configured)).not.toContain("webhook-secret");

      const testEvent = await admin.fetch(`/api/v1/webhooks/${configured[0]?.id}/test`, { method: "POST" });
      expect(testEvent.status).toBe(201);
      const delivery = (await testEvent.json()).data as { status: string; lastError: string; event: string };
      expect(delivery.status).toBe("failed");
      expect(delivery.lastError).toContain("timed out");
      expect(delivery.event).toContain("users.");
      const anonTest = await client(runtime).fetch(`/api/v1/webhooks/${configured[0]?.id}/test`, { method: "POST" });
      expect(anonTest.status).toBe(401);
      await runtime.close();
    } finally {
      receiver.stop();
    }
  });

  test("delivered rows older than retainDays are deleted", async () => {
    const runtime = await boot();
    const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
    await runtime.db
      .insertInto(WEBHOOK_OUTBOX_TABLE)
      .values({
        id: "old-delivered",
        webhook_id: "wh_1",
        event: "items.create",
        url: "http://127.0.0.1/hook",
        payload: "{}",
        headers: "{}",
        attempts: 1,
        status: "delivered",
        last_status_code: 200,
        last_error: null,
        locked_until: null,
        next_attempt_at: old,
        delivered_at: old,
        created_at: old,
      })
      .execute();
    await runtime.db
      .insertInto(WEBHOOK_OUTBOX_TABLE)
      .values({
        id: "old-failed",
        webhook_id: "wh_1",
        event: "items.create",
        url: "http://127.0.0.1/hook",
        payload: "{}",
        headers: "{}",
        attempts: 10,
        status: "failed",
        last_status_code: 500,
        last_error: "nope",
        locked_until: null,
        next_attempt_at: old,
        delivered_at: null,
        created_at: old,
      })
      .execute();
    const removed = await cleanupDelivered(runtime.db, 30);
    expect(removed).toBe(1);
    const left = await runtime.db.selectFrom(WEBHOOK_OUTBOX_TABLE).select("id").execute();
    expect(left.map((row) => row.id)).toEqual(["old-failed"]);
    await runtime.close();
  });

  test("ensureSystemTables adds status on an existing outbox table", async () => {
    const dir = await tempProject();
    await mkdir(join(dir, "data"), { recursive: true });
    const dbPath = join(dir, "data/app.db");
    const sqlite = new Database(dbPath);
    sqlite.run(`
      create table _bakorin_webhook_outbox (
        id text primary key,
        url text not null,
        payload text not null,
        headers text not null,
        attempts integer not null,
        locked_until text,
        next_attempt_at text not null,
        delivered_at text,
        created_at text not null
      )
    `);
    sqlite.close();
    const runtime = await createRuntime({
      projectDir: dir,
      yamlSource: await Bun.file(join(dir, "app.yaml")).text(),
    });
    const info = await runtime.db.selectFrom(WEBHOOK_OUTBOX_TABLE).selectAll().limit(1).execute();
    expect(info).toEqual([]);
    const columns = new Database(dbPath)
      .query("pragma table_info(_bakorin_webhook_outbox)")
      .all() as Array<{ name: string }>;
    const names = columns.map((column) => column.name);
    expect(names).toContain("status");
    expect(names).toContain("last_status_code");
    expect(names).toContain("last_error");
    expect(names).toContain("webhook_id");
    await runtime.close();
  });
});
