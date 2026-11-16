import { describe, expect, test } from "bun:test";
import { compileAppYaml } from "@bakorin/core";
import { importAppYaml, toAppYaml, validateConfig } from "../packages/core/src/builder.ts";
import { runDueJobs } from "@bakorin/server";
import { boot, client } from "./helpers.ts";

const JOBS_YAML = `
app:
  name: mini
runtime:
  dialect: sqlite
  sqlite:
    path: ./data/app.db
  files:
    path: ./data/uploads
  jwt:
    secret: test-jwt-secret-0123456789-abcdefghijklmnop
  hooks: ./hooks.ts
  jobs:
    retainDays: 30
auth:
  entity: users
  adminRole: admin
entities:
  users:
    auth: true
    fields:
      email: { type: email, unique: true, required: true }
      password: { type: password, required: true }
      name: { type: text, required: true }
      role: { type: enum, values: [user, admin], default: user }
    policies:
      read: authenticated
      create: public
      update: owner(id)
      delete: admin
jobs:
  - name: ping
    cron: "0 0 1 1 *"
  - name: boom
    cron: "0 0 1 1 *"
    handler: fail
    enabled: false
  - name: slow
    cron: "0 0 1 1 *"
    timeoutSeconds: 1
`;

const JOBS_HOOKS = `
import type { BakorinHooks } from "@bakorin/server";

const hooks: BakorinHooks = {
  jobs: {
    ping(ctx) {
      ctx.log("hello from ping");
      if (ctx.dryRun) return { ok: true, message: "dry run" };
      return { ok: true, message: "pong", data: { trigger: ctx.trigger } };
    },
    fail() {
      return { ok: false, message: "nope" };
    },
    async slow(ctx) {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => resolve(undefined), 5000);
        ctx.signal.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(new Error("aborted"));
        });
      });
    },
  },
};

export default hooks;
`;

async function adminClient(runtime: Awaited<ReturnType<typeof boot>>) {
  const http = client(runtime);
  const first = await http.fetch("/api/v1/auth/first-admin", {
    method: "POST",
    body: JSON.stringify({ email: "ada@studio.test", password: "password123", name: "Ada" }),
  });
  expect(first.status).toBe(201);
  const token = ((await first.json()) as { data: { accessToken: string } }).data.accessToken;
  return client(runtime, token);
}

describe("jobs runner and admin API", () => {
  test("lists jobs, runs one now, and records history", async () => {
    const runtime = await boot(JOBS_YAML, JOBS_HOOKS, { workers: false });
    try {
      const api = await adminClient(runtime);
      const listed = await api.fetch("/api/v1/jobs");
      expect(listed.status).toBe(200);
      const jobs = (await listed.json()) as { data: Array<{ name: string; enabled: boolean; lastRun: null }> };
      expect(jobs.data.map((job) => job.name)).toEqual(["ping", "boom", "slow"]);
      expect(jobs.data[0]?.lastRun).toBeNull();

      const ran = await api.fetch("/api/v1/jobs/ping/run", { method: "POST", body: "{}" });
      expect(ran.status).toBe(201);
      const created = (await ran.json()) as { data: { status: string; message: string; trigger: string; dryRun: boolean; data: { trigger: string } } };
      expect(created.data.status).toBe("ok");
      expect(created.data.message).toBe("pong");
      expect(created.data.trigger).toBe("manual");
      expect(created.data.dryRun).toBe(false);
      expect(created.data.data).toEqual({ trigger: "manual" });

      const dry = await api.fetch("/api/v1/jobs/ping/run", { method: "POST", body: JSON.stringify({ dryRun: true }) });
      expect(dry.status).toBe(201);
      const dryBody = (await dry.json()) as { data: { message: string; dryRun: boolean } };
      expect(dryBody.data.message).toBe("dry run");
      expect(dryBody.data.dryRun).toBe(true);

      const failed = await api.fetch("/api/v1/jobs/boom/run", { method: "POST", body: "{}" });
      expect(failed.status).toBe(200);
      const failedBody = (await failed.json()) as { data: { status: string; message: string } };
      expect(failedBody.data.status).toBe("error");
      expect(failedBody.data.message).toBe("nope");

      const timed = await api.fetch("/api/v1/jobs/slow/run", { method: "POST", body: "{}" });
      expect(timed.status).toBe(200);
      const timedBody = (await timed.json()) as { data: { status: string; message: string } };
      expect(timedBody.data.status).toBe("error");
      expect(timedBody.data.message).toContain("timed out");

      const missing = await api.fetch("/api/v1/jobs/nope/run", { method: "POST", body: "{}" });
      expect(missing.status).toBe(404);

      const history = await api.fetch("/api/v1/jobs/runs?limit=10");
      expect(history.status).toBe(200);
      const runs = (await history.json()) as { data: Array<{ jobName: string }>; meta: { total: number } };
      expect(runs.meta.total).toBe(4);
      expect(runs.data.length).toBe(4);
    } finally {
      await runtime.close();
    }
  });

  test("runs a due scheduled slot once and skips a second tick for the same slot", async () => {
    const runtime = await boot(JOBS_YAML, JOBS_HOOKS, { workers: false });
    try {
      const now = new Date("2026-01-01T00:00:00.000Z");
      const first = await runDueJobs(runtime.context, now, { since: new Date("2025-12-31T00:00:00.000Z") });
      const ping = first.find((item) => item.status !== "skipped");
      expect(ping?.status).toBe("ok");
      if (ping && "run" in ping) {
        expect(ping.run.trigger).toBe("scheduled");
        expect(ping.run.scheduledFor).toBe("2026-01-01T00:00:00.000Z");
      }
      const second = await runDueJobs(runtime.context, now, { since: new Date("2025-12-31T00:00:00.000Z") });
      expect(second.some((item) => item.status === "ok")).toBe(false);
      expect(second.filter((item) => item.status === "skipped" && item.reason === "already_ran").length).toBeGreaterThan(0);
    } finally {
      await runtime.close();
    }
  });

  test("round-trips jobs through the config builder", () => {
    const original = `${JOBS_YAML}`;
    const { config, warnings } = importAppYaml(original);
    expect(warnings).toEqual([]);
    expect(config.jobs.map((job) => job.name)).toEqual(["ping", "boom", "slow"]);
    expect(config.jobs[1]?.enabled).toBe(false);
    expect(config.jobs[1]?.handler).toBe("fail");
    const result = validateConfig(config);
    expect(result.issues.filter((issue) => issue.severity === "error")).toEqual([]);
    const yaml = toAppYaml(config);
    expect(yaml).toContain("name: ping");
    expect(yaml).toContain("handler: fail");
    expect(yaml).toContain("enabled: false");
    expect(compileAppYaml(yaml, { env: {}, production: false }).jobs.map((job) => job.name)).toEqual(
      compileAppYaml(original, { env: {}, production: false }).jobs.map((job) => job.name),
    );
  });
});
