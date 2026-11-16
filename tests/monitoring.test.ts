import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { compileAppYaml, serializeAst } from "@bakorin/core";
import { createRuntime, type RuntimeHandles } from "@bakorin/server";
import { MAIL_OUTBOX_TABLE, metaSet, WEBHOOK_OUTBOX_TABLE } from "../packages/server/src/db/system.ts";
import { checkAlerts } from "../packages/server/src/monitor/alerts.ts";
import { parseSentryDsn, scrubMessage } from "../packages/server/src/monitor/monitor.ts";
import { client, MINI_YAML, tempProject } from "./helpers.ts";

const THROWING_HOOKS = `export default {
  entities: {},
  routes(app) {
    app.get("/boom", () => {
      throw new Error("lookup failed for ada@studio.test with token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJlc2lnbmF0dXJl");
    });
  },
};
`;

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  while (cleanups.length) {
    await cleanups.pop()!();
  }
});

async function start(options: { env?: Record<string, string>; yaml?: string; hooks?: string } = {}) {
  const dir = await tempProject(options.yaml ?? MINI_YAML, options.hooks);
  const runtime = await createRuntime({
    projectDir: dir,
    yamlSource: options.yaml ?? MINI_YAML,
    env: { JWT_SECRET: "test-secret-test-secret-test-secret-32", ...options.env },
    workers: false,
  });
  cleanups.push(() => runtime.close());
  return Object.assign(runtime, { dir });
}

async function adminToken(runtime: RuntimeHandles & { dir: string }): Promise<string> {
  const first = await client(runtime).fetch("/api/v1/auth/first-admin", {
    method: "POST",
    body: JSON.stringify({ email: "ada@studio.test", password: "password123", name: "Ada" }),
  });
  expect(first.status).toBe(201);
  return ((await first.json()) as { data: { accessToken: string } }).data.accessToken;
}

async function memberToken(runtime: RuntimeHandles & { dir: string }): Promise<string> {
  const signup = await client(runtime).fetch("/api/v1/auth/signup", {
    method: "POST",
    body: JSON.stringify({ email: "member@studio.test", password: "password123", name: "Member" }),
  });
  return ((await signup.json()) as { data: { accessToken: string } }).data.accessToken;
}

function receiver() {
  const received: Array<{ path: string; headers: Headers; body: string }> = [];
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      received.push({ path: new URL(request.url).pathname, headers: request.headers, body: await request.text() });
      return new Response("ok");
    },
  });
  cleanups.push(() => server.stop(true));
  return { url: `http://127.0.0.1:${server.port}`, received };
}

async function failedMail(runtime: RuntimeHandles, id = "mail-1"): Promise<void> {
  const now = new Date().toISOString();
  await runtime.db
    .insertInto(MAIL_OUTBOX_TABLE)
    .values({
      id,
      idempotency_key: `k-${id}`,
      source: "test",
      to_addrs: '["client@example.com"]',
      cc_addrs: "[]",
      bcc_addrs: "[]",
      subject: "Your invoice",
      html: "<p>x</p>",
      body_text: "x",
      attempts: 5,
      max_attempts: 5,
      status: "failed",
      last_error: "smtp refused",
      next_attempt_at: now,
      created_at: now,
    })
    .execute();
}

describe("monitoring: requests", () => {
  test("every response carries a request id; a safe incoming id is kept", async () => {
    const runtime = await start();
    const generated = await client(runtime).fetch("/health");
    expect(generated.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    const kept = await client(runtime).fetch("/health", { headers: { "x-request-id": "edge-proxy-1234" } });
    expect(kept.headers.get("x-request-id")).toBe("edge-proxy-1234");
    const replaced = await client(runtime).fetch("/health", { headers: { "x-request-id": "bad id with spaces" } });
    expect(replaced.headers.get("x-request-id")).not.toContain("bad");
  });

  test("JSON request logs have the fields and never the query string or token", async () => {
    const lines: string[] = [];
    const spy = spyOn(console, "log").mockImplementation((line?: unknown) => {
      lines.push(String(line));
    });
    cleanups.push(() => spy.mockRestore());
    const runtime = await start({ env: { BAKORIN_REQUEST_LOG: "json" } });
    const token = await adminToken(runtime);
    await client(runtime, token).fetch("/api/v1/items?filter=secret-search-term&sig=abc", {
      headers: { "x-request-id": "req-12345678" },
    });
    const entry = lines
      .filter((line) => line.startsWith("{"))
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .find((item) => item.requestId === "req-12345678");
    expect(entry).toBeTruthy();
    expect(Object.keys(entry!).sort()).toEqual(["durationMs", "level", "method", "msg", "path", "requestId", "status", "ts", "userId"]);
    expect(entry).toMatchObject({ msg: "request", method: "GET", path: "/api/v1/items", status: 200, level: "info" });
    expect(typeof entry!.userId).toBe("string");
    const all = lines.join("\n");
    expect(all).not.toContain("secret-search-term");
    expect(all).not.toContain(token);
    expect(all).not.toContain("password123");
  });

  test("logs are off by default outside production and on in production", async () => {
    const { requestLogMode } = await import("../packages/server/src/monitor/monitor.ts");
    expect(requestLogMode({})).toBe("off");
    expect(requestLogMode({ NODE_ENV: "production" })).toBe("json");
    expect(requestLogMode({ NODE_ENV: "production", BAKORIN_REQUEST_LOG: "off" })).toBe("off");
    expect(requestLogMode({ BAKORIN_REQUEST_LOG: "pretty" })).toBe("pretty");
  });
});

describe("monitoring: errors", () => {
  test("unhandled errors return JSON with the request id, are kept, and forwarded scrubbed", async () => {
    const sentry = receiver();
    const hook = receiver();
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    cleanups.push(() => errorSpy.mockRestore());
    const dsn = sentry.url.replace("http://", "http://publickey@") + "/42";
    const runtime = await start({ hooks: THROWING_HOOKS, env: { SENTRY_DSN: dsn, ERROR_WEBHOOK_URL: `${hook.url}/errors` } });
    const response = await client(runtime).fetch("/boom?email=ada@studio.test", { headers: { "x-request-id": "boom-request-1" } });
    expect(response.status).toBe(500);
    const body = (await response.json()) as { error: { code: string; requestId: string; message: string } };
    expect(body.error).toEqual({ code: "internal", message: "Something went wrong on the server.", requestId: "boom-request-1" });
    await runtime.context.monitor.flush();

    expect(sentry.received).toHaveLength(1);
    expect(sentry.received[0]!.path).toBe("/api/42/envelope/");
    expect(sentry.received[0]!.headers.get("x-sentry-auth")).toContain("sentry_key=publickey");
    const [, , eventLine] = sentry.received[0]!.body.trim().split("\n");
    const event = JSON.parse(eventLine!) as { exception: { values: Array<{ value: string }> }; tags: Record<string, string> };
    expect(event.tags.request_id).toBe("boom-request-1");
    expect(event.exception.values[0]!.value).toContain("[email]");
    expect(event.exception.values[0]!.value).toContain("[token]");
    expect(sentry.received[0]!.body).not.toContain("ada@studio.test");

    expect(hook.received).toHaveLength(1);
    const payload = JSON.parse(hook.received[0]!.body) as Record<string, unknown>;
    expect(payload).toMatchObject({ type: "bakorin.error", requestId: "boom-request-1", path: "/boom", status: 500 });
    expect(hook.received[0]!.body).not.toContain("ada@studio.test");

    const token = await adminToken(runtime);
    const status = (await (await client(runtime, token).fetch("/api/v1/status")).json()) as {
      data: { errors: { total: number; recent: Array<{ requestId: string; path: string }>; forwarding: { sentry: boolean; webhook: boolean } } };
    };
    expect(status.data.errors.total).toBe(1);
    expect(status.data.errors.recent[0]).toMatchObject({ requestId: "boom-request-1", path: "/boom" });
    expect(status.data.errors.forwarding).toEqual({ sentry: true, webhook: true });
  });

  test("forwarding is off by default and helpers behave", async () => {
    const runtime = await start();
    expect(runtime.context.monitor.errorForwarding).toEqual({ sentry: false, webhook: false });
    expect(parseSentryDsn("https://abc@o1.ingest.sentry.io/123", "1.0.0")?.url).toBe("https://o1.ingest.sentry.io/api/123/envelope/");
    expect(parseSentryDsn("not a dsn", "1")).toBeNull();
    expect(scrubMessage("postgres://bakorin:hunter2@db/app failed")).toBe("postgres://bakorin:[redacted]@db/app failed");
  });
});

describe("monitoring: health, ready, metrics", () => {
  test("/health and /ready are public; /ready checks the database and storage", async () => {
    const runtime = await start();
    expect((await client(runtime).fetch("/health")).status).toBe(200);
    const ready = await client(runtime).fetch("/ready");
    expect(ready.status).toBe(200);
    const body = (await ready.json()) as { ok: boolean; checks: Record<string, { ok: boolean }> };
    expect(body.ok).toBe(true);
    expect(body.checks.database?.ok).toBe(true);
    expect(body.checks.storage?.ok).toBe(true);
  });

  test("/ready returns 503 when storage is not usable", async () => {
    const runtime = await start();
    await writeFile(join(runtime.dir, "blocker"), "x");
    runtime.context.ast = {
      ...runtime.context.ast,
      runtime: { ...runtime.context.ast.runtime, files: { ...runtime.context.ast.runtime.files, path: "./blocker/uploads" } },
    };
    const ready = await client(runtime).fetch("/ready");
    expect(ready.status).toBe(503);
    const body = (await ready.json()) as { checks: { storage: { ok: boolean; error: string } } };
    expect(body.checks.storage).toMatchObject({ ok: false, error: "unavailable" });
  });

  test("/metrics is hidden without METRICS_TOKEN and guarded with it", async () => {
    const off = await start();
    expect((await client(off).fetch("/metrics")).status).toBe(404);
    const on = await start({ env: { METRICS_TOKEN: "metrics-token-for-tests" } });
    expect((await client(on).fetch("/metrics")).status).toBe(401);
    expect((await client(on, "wrong-token").fetch("/metrics")).status).toBe(401);
    await client(on).fetch("/health");
    const ok = await client(on, "metrics-token-for-tests").fetch("/metrics");
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toContain("text/plain");
    const text = await ok.text();
    for (const name of [
      "bakorin_up 1",
      'bakorin_http_requests_total{method="GET",status="200"}',
      "bakorin_http_request_duration_seconds_bucket",
      'bakorin_outbox_items{queue="mail",state="failed"} 0',
      "bakorin_db_size_bytes",
      "bakorin_last_backup_timestamp_seconds 0",
      "bakorin_errors_total 0",
    ]) {
      expect(text).toContain(name);
    }
  });
});

describe("monitoring: status page API", () => {
  test("admin only, with uptime, version, database, queues, backups", async () => {
    const runtime = await start({ env: { BAKORIN_COMMIT: "abc1234def" } });
    const token = await adminToken(runtime);
    const member = await memberToken(runtime);
    expect((await client(runtime).fetch("/api/v1/status")).status).toBe(401);
    expect((await client(runtime, member).fetch("/api/v1/status")).status).toBe(403);
    await failedMail(runtime);
    const now = new Date().toISOString();
    await runtime.db
      .insertInto(WEBHOOK_OUTBOX_TABLE)
      .values({
        id: "hook-1",
        url: "https://hooks.example.com/in?secret=abc",
        event: "items.create",
        payload: "{}",
        headers: "{}",
        attempts: 2,
        status: "pending",
        next_attempt_at: now,
        created_at: new Date(Date.now() - 90_000).toISOString(),
      })
      .execute();
    const response = await client(runtime, token).fetch("/api/v1/status");
    expect(response.status).toBe(200);
    const data = (await response.json()).data as Record<string, any>;
    expect(data.commit).toBe("abc1234def");
    expect(typeof data.version).toBe("string");
    expect(data.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(data.database.dialect).toBe("sqlite");
    expect(data.database.sizeBytes).toBeGreaterThan(0);
    expect(data.queues.mail).toMatchObject({ failed: 1, pending: 0 });
    expect(data.queues.mail.failedItems[0]).toMatchObject({ id: "mail-1", label: "Your invoice", lastError: "smtp refused" });
    expect(data.queues.webhooks).toMatchObject({ retrying: 1, failed: 0 });
    expect(data.queues.webhooks.oldestPendingAgeSeconds).toBeGreaterThanOrEqual(89);
    expect(data.backups).toMatchObject({ lastAt: null, overdue: false });
    expect(JSON.stringify(data)).not.toContain("secret=abc");

    // Discard and retry from the Status page.
    expect((await client(runtime, member).fetch("/api/v1/mail/deliveries/mail-1/discard", { method: "POST" })).status).toBe(403);
    expect((await client(runtime, token).fetch("/api/v1/webhooks/deliveries/hook-1/discard", { method: "POST" })).status).toBe(409);
    const discarded = await client(runtime, token).fetch("/api/v1/mail/deliveries/mail-1/discard", { method: "POST" });
    expect(discarded.status).toBe(200);
    const after = (await (await client(runtime, token).fetch("/api/v1/status")).json()).data as Record<string, any>;
    expect(after.queues.mail).toMatchObject({ failed: 0, discarded: 1 });
    expect((await client(runtime, token).fetch("/api/v1/mail/deliveries?status=discarded")).status).toBe(200);
    expect((await client(runtime, token).fetch("/api/v1/mail/deliveries/nope/discard", { method: "POST" })).status).toBe(404);
  });

  test("records the last backup", async () => {
    const runtime = await start();
    const token = await adminToken(runtime);
    expect((await client(runtime, token).fetch("/api/v1/backups", { method: "POST" })).status).toBe(201);
    const data = (await (await client(runtime, token).fetch("/api/v1/status")).json()).data as Record<string, any>;
    expect(Date.now() - Date.parse(data.backups.lastAt)).toBeLessThan(60_000);
    expect(data.backups.lastLocation).toContain("data/backups");
  });
});

describe("monitoring: alerts", () => {
  const ALERT_YAML = (url: string) =>
    MINI_YAML.replace(
      "  hooks: ./hooks.ts\n",
      `  hooks: ./hooks.ts\n  alerts:\n    email: ops@studio.test\n    webhook: ${url}/alerts\n    backupMaxAgeHours: 0.0001\n`,
    );

  test("alerts once when a condition starts and once when it clears", async () => {
    const hook = receiver();
    const runtime = await start({ yaml: ALERT_YAML(hook.url) });
    await Bun.sleep(400);
    const first = await checkAlerts(runtime.context, runtime.context.monitor);
    expect(first).toEqual([{ kind: "started", condition: "backup_overdue" }]);
    await failedMail(runtime);
    const second = await checkAlerts(runtime.context, runtime.context.monitor);
    expect(second).toEqual([{ kind: "started", condition: "queue_failed" }]);
    expect(await checkAlerts(runtime.context, runtime.context.monitor)).toEqual([]);
    await metaSet(runtime.db, "last_backup_at", new Date().toISOString());
    await runtime.db.updateTable(MAIL_OUTBOX_TABLE).set({ status: "discarded" }).where("id", "=", "mail-1").execute();
    const cleared = await checkAlerts(runtime.context, runtime.context.monitor);
    expect(cleared.sort((a, b) => a.condition.localeCompare(b.condition))).toEqual([
      { kind: "cleared", condition: "backup_overdue" },
      { kind: "cleared", condition: "queue_failed" },
    ]);
    const bodies = hook.received.map((item) => JSON.parse(item.body) as { type: string; condition: string });
    expect(bodies.map((item) => `${item.type}:${item.condition}`).sort()).toEqual([
      "bakorin.alert.cleared:backup_overdue",
      "bakorin.alert.cleared:queue_failed",
      "bakorin.alert.started:backup_overdue",
      "bakorin.alert.started:queue_failed",
    ]);
    const alertMail = await runtime.db
      .selectFrom(MAIL_OUTBOX_TABLE)
      .select(["to_addrs", "subject"])
      .where("idempotency_key", "like", "hook:alert:%")
      .execute();
    expect(alertMail.length).toBe(4);
    expect(alertMail.every((row) => String(row.to_addrs).includes("ops@studio.test"))).toBe(true);
    expect(alertMail.some((row) => String(row.subject).includes("deliveries are failing"))).toBe(true);
  });

  test("no alerts unless configured", async () => {
    const runtime = await start();
    await failedMail(runtime);
    expect(await checkAlerts(runtime.context, runtime.context.monitor)).toEqual([]);
  });

  test("the stored schema copy never contains secrets", () => {
    const ast = compileAppYaml(
      MINI_YAML.replace("  hooks: ./hooks.ts\n", "  hooks: ./hooks.ts\n  alerts:\n    webhook: https://hooks.example.com/x?token=alert-secret\n"),
      { env: { JWT_SECRET: "test-secret-test-secret-test-secret-32" } },
    );
    const stored = serializeAst(ast);
    expect(stored).not.toContain("test-secret-test-secret-test-secret-32");
    expect(stored).not.toContain("alert-secret");
    expect(ast.runtime.jwtSecret).toBe("test-secret-test-secret-test-secret-32");
  });
});
