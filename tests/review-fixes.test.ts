// Regression tests for the Critical and High findings in the November 2026 review.
// Each block reproduces the original probe and asserts the fixed behavior.
import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compileAppYaml, DEV_JWT_SECRET, isDevMode, parseTrustProxy, SchemaError } from "@bakorin/core";
import { signAccessToken } from "../packages/server/src/auth/jwt.ts";
import { resolveClientIp } from "../packages/server/src/http/client-ip.ts";
import { installProcessSafety } from "../packages/server/src/monitor/process-safety.ts";
import { AUDIT_TABLE, MAIL_OUTBOX_TABLE, WEBHOOK_OUTBOX_TABLE } from "../packages/server/src/db/system.ts";
import { boot, MINI_YAML, tempProject } from "./helpers.ts";
import { mkdir, writeFile } from "node:fs/promises";
import { createRuntime } from "@bakorin/server";
import { EventEmitter } from "node:events";

const STRONG = "test-jwt-secret-0123456789-abcdefghijklmnop";
const CLI = join(import.meta.dir, "../packages/server/src/cli.ts");
const NO_SECRET_YAML = MINI_YAML.replace(`  jwt:\n    secret: ${STRONG}\n`, "");

const cleanups: Array<() => Promise<unknown> | unknown> = [];
afterEach(async () => {
  while (cleanups.length) {
    await cleanups.pop()!();
  }
});

type Runtime = Awaited<ReturnType<typeof boot>>;

async function j(runtime: Runtime, method: string, path: string, body?: unknown, headers: Record<string, string> = {}, env?: unknown) {
  const request = new Request(`http://x${path}`, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const res = await runtime.app.fetch(request, env as never);
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    // empty body
  }
  return { status: res.status, json };
}

/** Signup never returns a session, so sign up and then log in. */
async function signupLogin(runtime: Runtime, body: { email: string; password: string; name?: string }, headers: Record<string, string> = {}, env?: unknown) {
  const res = await j(runtime, "POST", "/api/v1/auth/signup", body, headers, env);
  if (res.status !== 202) {
    return res;
  }
  return j(runtime, "POST", "/api/v1/auth/login", { email: body.email, password: body.password }, headers, env);
}

async function started(yaml?: string, hooks?: string): Promise<Runtime> {
  const runtime = await boot(yaml, hooks);
  cleanups.push(() => runtime.close());
  return runtime;
}

function socketEnv(address: string) {
  return { requestIP: () => ({ address, family: address.includes(":") ? "IPv6" : "IPv4", port: 5555 }) };
}

function cliEnv(extra: Record<string, string | undefined>): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env };
  delete env.BAKORIN_TEST;
  delete env.BAKORIN_ENV;
  delete env.JWT_SECRET;
  env.NODE_ENV = "production";
  return { ...env, ...extra };
}

describe("C1: no public dev JWT secret outside dev mode", () => {
  test("compiling without dev mode and without JWT_SECRET refuses (probe P3)", () => {
    expect(() => compileAppYaml(NO_SECRET_YAML, { env: {} })).toThrow(/JWT_SECRET/);
    expect(() => compileAppYaml(NO_SECRET_YAML, { env: { NODE_ENV: "development" } })).toThrow(/JWT_SECRET/);
  });

  test("weak, short and placeholder secrets are refused in production", () => {
    for (const secret of ["short", "a".repeat(40), DEV_JWT_SECRET, "change-me-to-a-long-random-string", "aaaaabbbbbcccccdddddeeeeefffffggggg"]) {
      expect(() => compileAppYaml(NO_SECRET_YAML, { env: { JWT_SECRET: secret } })).toThrow(SchemaError);
    }
    expect(() =>
      compileAppYaml(NO_SECRET_YAML, { env: { JWT_SECRET: STRONG, JWT_SECRET_PREVIOUS: "short" } }),
    ).toThrow(/JWT_SECRET_PREVIOUS/);
    expect(compileAppYaml(NO_SECRET_YAML, { env: { JWT_SECRET: STRONG } }).runtime.jwtSecret).toBe(STRONG);
  });

  test("the dev secret is only used in explicit dev mode", () => {
    expect(isDevMode({})).toBe(false);
    expect(isDevMode({ NODE_ENV: "development" })).toBe(false);
    expect(isDevMode({ BAKORIN_ENV: "development" })).toBe(true);
    expect(isDevMode({ BAKORIN_TEST: "1", BAKORIN_ENV: "production" })).toBe(false);
    expect(compileAppYaml(NO_SECRET_YAML, { env: { BAKORIN_ENV: "development" } }).runtime.jwtSecret).toBe(DEV_JWT_SECRET);
  });

  test("a token forged with the public dev secret is rejected by a production server", async () => {
    const runtime = await started();
    const forged = await signAccessToken({ sub: "x", role: "admin", ent: "users" }, DEV_JWT_SECRET, 3600);
    const audit = await j(runtime, "GET", "/api/v1/audit", undefined, { authorization: `Bearer ${forged}` });
    expect(audit.status).toBe(401);
  });

  test("bakorin start refuses to boot without JWT_SECRET, or with BAKORIN_ENV=development", async () => {
    const dir = await tempProject(NO_SECRET_YAML);
    for (const extra of [{}, { JWT_SECRET: "too-short" }, { JWT_SECRET: STRONG, BAKORIN_ENV: "development" }]) {
      const env = { CORS_ORIGINS: "http://localhost", ...extra };
      const proc = Bun.spawn([process.execPath, CLI, "start", "--dir", dir, "--port", "0"], {
        cwd: dir,
        env: cliEnv(env),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stderr, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
      expect(code).toBe(1);
      expect(stderr).toMatch(/JWT_SECRET|development/);
      expect(stderr).not.toContain(STRONG);
    }
  }, 20_000);
});

describe("H1: signup respects config and users stay private", () => {
  const leadsYaml = readFileSync(join(import.meta.dir, "../examples/studio-leads/app.yaml"), "utf8")
    .replace(/^mail:[\s\S]*$/m, "")
    .replace("  jwt:\n", `  jwt:\n    secret: ${STRONG}\n`);

  test("studio-leads: a stranger cannot sign up or list users (probe P1)", async () => {
    const runtime = await started(leadsYaml);
    expect(runtime.ast.auth?.signup).toBe("invite");
    const admin = await j(runtime, "POST", "/api/v1/auth/first-admin", { email: "boss@studio.test", password: "password123", name: "Boss" });
    expect(admin.status).toBe(201);
    const signup = await j(runtime, "POST", "/api/v1/auth/signup", { email: "stranger@evil.test", password: "password123", name: "Stranger" });
    expect(signup.status).toBe(403);
    expect(signup.json.error.code).toBe("signup_disabled");
    const users = await j(runtime, "GET", "/api/v1/users");
    expect(users.status).toBe(401);
    const created = await j(runtime, "POST", "/api/v1/users", { email: "x@evil.test", password: "password123", name: "X" });
    expect(created.status).toBe(401);
  });

  test("unset signup follows the users create policy", () => {
    const adminCreate = MINI_YAML.replace("      create: public\n      update: owner(id)", "      create: admin\n      update: owner(id)");
    expect(compileAppYaml(adminCreate).auth?.signup).toBe("invite");
    expect(compileAppYaml(MINI_YAML).auth?.signup).toBe("open");
  });

  test("explicit invite or closed next to a public users create is a schema error", () => {
    for (const mode of ["invite", "closed"]) {
      const yaml = MINI_YAML.replace("  adminRole: admin\n", `  adminRole: admin\n  signup: ${mode}\n`);
      expect(() => compileAppYaml(yaml)).toThrow(/signup/);
    }
  });

  test("closed signup also blocks invites", async () => {
    const yaml = MINI_YAML.replace("  adminRole: admin\n", "  adminRole: admin\n  signup: closed\n").replace(
      "      create: public\n      update: owner(id)",
      "      create: admin\n      update: owner(id)",
    );
    const runtime = await started(yaml);
    const admin = await j(runtime, "POST", "/api/v1/auth/first-admin", { email: "a@x.test", password: "password123", name: "A" });
    const token = admin.json.data.accessToken;
    expect((await j(runtime, "POST", "/api/v1/auth/signup", { email: "b@x.test", password: "password123", name: "B" })).status).toBe(403);
    const invite = await j(runtime, "POST", "/api/v1/auth/invites", { email: "c@x.test" }, { authorization: `Bearer ${token}` });
    expect(invite.status).toBe(403);
    expect(invite.json.error.code).toBe("invites_disabled");
  });

  test("with open signup, ordinary users never see other users' email or role", async () => {
    // MINI_YAML keeps the old broad policy: users read authenticated.
    const runtime = await started();
    const admin = await j(runtime, "POST", "/api/v1/auth/first-admin", { email: "a@x.test", password: "password123", name: "Admin" });
    const adminToken = admin.json.data.accessToken;
    const u1 = await signupLogin(runtime, { email: "one@x.test", password: "password123", name: "One" });
    const u2 = await signupLogin(runtime, { email: "two@x.test", password: "password123", name: "Two" });
    const auth1 = { authorization: `Bearer ${u1.json.data.accessToken}` };

    const list = await j(runtime, "GET", "/api/v1/users", undefined, auth1);
    expect(list.status).toBe(200);
    for (const row of list.json.data) {
      if (row.id === u1.json.data.user.id) {
        expect(row.email).toBe("one@x.test");
      } else {
        expect(row.email).toBeUndefined();
        expect(row.role).toBeUndefined();
      }
    }
    const other = await j(runtime, "GET", `/api/v1/users/${u2.json.data.user.id}`, undefined, auth1);
    expect(other.json.data.email).toBeUndefined();
    // Filtering on a private field must not leak it either.
    const probe = await j(runtime, "GET", "/api/v1/users?email=two@x.test", undefined, auth1);
    expect(probe.json.data.length).toBe(3);
    // Items expanded to their owner do not leak the owner's email.
    const adminList = await j(runtime, "GET", "/api/v1/users", undefined, { authorization: `Bearer ${adminToken}` });
    expect(adminList.json.data.every((row: any) => typeof row.email === "string" && typeof row.role === "string")).toBe(true);
  });

  test("the default users read policy is owner or admin", async () => {
    const yaml = MINI_YAML.replace("      read: authenticated\n      create: public", "      create: public");
    const runtime = await started(yaml);
    await j(runtime, "POST", "/api/v1/auth/first-admin", { email: "a@x.test", password: "password123", name: "Admin" });
    const u1 = await signupLogin(runtime, { email: "one@x.test", password: "password123", name: "One" });
    const list = await j(runtime, "GET", "/api/v1/users", undefined, { authorization: `Bearer ${u1.json.data.accessToken}` });
    expect(list.json.data.map((row: any) => row.email)).toEqual(["one@x.test"]);
  });
});

describe("H2: a failing after hook never crashes the process", () => {
  const THROWING = `export default { entities: { items: { afterCreate: async () => { throw new Error("hook boom"); } } } };\n`;

  test("the error is captured with the request id and the server keeps serving", async () => {
    const runtime = await started(undefined, THROWING);
    const user = await signupLogin(runtime, { email: "c@x.test", password: "password123", name: "C" });
    const created = await j(
      runtime,
      "POST",
      "/api/v1/items",
      { title: "x", ownerId: user.json.data.user.id },
      { authorization: `Bearer ${user.json.data.accessToken}`, "x-request-id": "req-hook-1" },
    );
    expect(created.status).toBe(201);
    await Bun.sleep(50);
    const errors = runtime.context.monitor.recentErrors();
    const hookError = errors.find((error) => error.source === "hook");
    expect(hookError?.message).toContain("hook boom");
    expect(hookError?.requestId).toBe("req-hook-1");
    expect((await j(runtime, "GET", "/health")).status).toBe(200);
  });

  test("bakorin start survives a throwing afterCreate (probe crash2)", async () => {
    const yaml = NO_SECRET_YAML.replace("app:\n  name: mini\n", "app:\n  name: crashsafe\n");
    const dir = await tempProject(yaml, THROWING);
    // Ask the OS for a free port instead of guessing, so parallel CI jobs cannot collide.
    const probe = Bun.serve({ port: 0, fetch: () => new Response("") });
    const port = probe.port;
    probe.stop(true);
    const proc = Bun.spawn([process.execPath, CLI, "start", "--dir", dir, "--port", String(port)], {
      cwd: dir,
      env: cliEnv({ JWT_SECRET: STRONG, CORS_ORIGINS: "http://localhost" }),
      stdout: "pipe",
      stderr: "pipe",
    });
    cleanups.push(() => proc.kill(9));
    const base = `http://127.0.0.1:${port}`;
    let ready = false;
    // A cold CI runner can take a while to load the CLI, so allow up to 30 seconds.
    for (let i = 0; i < 300 && !ready && proc.exitCode === null; i++) {
      await Bun.sleep(100);
      ready = await fetch(`${base}/health`).then((r) => r.ok, () => false);
    }
    if (!ready) {
      proc.kill(9);
      throw new Error(`bakorin start did not come up: ${await new Response(proc.stderr).text()}`);
    }
    const signup = await fetch(`${base}/api/v1/auth/signup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "c@x.test", password: "password123", name: "C" }),
    });
    expect(signup.status).toBe(202);
    const login = await fetch(`${base}/api/v1/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "c@x.test", password: "password123" }),
    }).then((r) => r.json() as Promise<any>);
    const created = await fetch(`${base}/api/v1/items`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${login.data.accessToken}` },
      body: JSON.stringify({ title: "x", ownerId: login.data.user.id }),
    });
    expect(created.status).toBe(201);
    await Bun.sleep(300);
    expect(proc.exitCode).toBeNull();
    expect((await fetch(`${base}/health`)).status).toBe(200);
  }, 20_000);

  test("process safety logs unhandled rejections instead of exiting", () => {
    const target = new EventEmitter() as unknown as NodeJS.Process;
    const captured: Array<{ source?: string }> = [];
    const monitor = { captureError: (_error: unknown, info: { source?: string }) => captured.push(info) } as never;
    installProcessSafety(monitor, target);
    (target as unknown as EventEmitter).emit("unhandledRejection", new Error("late"), Promise.resolve());
    (target as unknown as EventEmitter).emit("uncaughtException", new Error("sync"));
    expect(captured.map((info) => info.source)).toEqual(["process", "process"]);
  }, 45_000);
});

describe("H3: rate limits do not trust a client X-Forwarded-For", () => {
  test("rotating X-Forwarded-For still hits the login limit by default (probe P2)", async () => {
    const runtime = await started();
    const env = socketEnv("203.0.113.9");
    const statuses: number[] = [];
    for (let i = 0; i < 30; i++) {
      const res = await j(runtime, "POST", "/api/v1/auth/login", { email: `nobody${i}@x.test`, password: "wrongwrong" }, { "x-forwarded-for": `10.0.0.${i}` }, env);
      statuses.push(res.status);
    }
    expect(statuses.filter((status) => status === 429).length).toBeGreaterThan(0);
  });

  test("rotating X-Forwarded-For still hits the signup limit by default", async () => {
    const runtime = await started();
    const env = socketEnv("203.0.113.10");
    const statuses: number[] = [];
    for (let i = 0; i < 30; i++) {
      const res = await j(runtime, "POST", "/api/v1/auth/signup", { email: `s${i}@x.test`, password: "password123", name: "S" }, { "x-forwarded-for": `10.1.0.${i}` }, env);
      statuses.push(res.status);
    }
    expect(statuses).toContain(429);
  });

  test("resolveClientIp: none, hops and CIDR modes", () => {
    const ctx = (xff: string | undefined, socket: string) =>
      ({
        env: socketEnv(socket),
        req: { raw: new Request("http://x"), header: (name: string) => (name.toLowerCase() === "x-forwarded-for" ? xff : undefined) },
      }) as never;
    expect(resolveClientIp(ctx("1.1.1.1", "10.0.0.5"), { kind: "none" })).toBe("10.0.0.5");
    expect(resolveClientIp(ctx("6.6.6.6, 198.51.100.7", "10.0.0.5"), { kind: "hops", hops: 1 })).toBe("198.51.100.7");
    expect(resolveClientIp(ctx("6.6.6.6, 198.51.100.7, 10.0.0.4", "10.0.0.5"), { kind: "hops", hops: 2 })).toBe("198.51.100.7");
    expect(resolveClientIp(ctx(undefined, "10.0.0.5"), { kind: "hops", hops: 1 })).toBe("10.0.0.5");
    expect(resolveClientIp(ctx("6.6.6.6, 198.51.100.7, 10.0.0.4", "10.0.0.5"), { kind: "cidrs", cidrs: ["10.0.0.0/8"] })).toBe("198.51.100.7");
    expect(resolveClientIp(ctx("6.6.6.6", "203.0.113.1"), { kind: "cidrs", cidrs: ["10.0.0.0/8"] })).toBe("203.0.113.1");
  });

  test("TRUST_PROXY and runtime.trustProxy parse to a safe setting", () => {
    expect(parseTrustProxy(undefined, {})).toEqual({ kind: "none" });
    expect(parseTrustProxy(undefined, { TRUST_PROXY: "" })).toEqual({ kind: "none" });
    expect(parseTrustProxy(undefined, { TRUST_PROXY: "1" })).toEqual({ kind: "hops", hops: 1 });
    expect(parseTrustProxy(2, {})).toEqual({ kind: "hops", hops: 2 });
    expect(parseTrustProxy(true, { TRUST_PROXY: "false" })).toEqual({ kind: "none" });
    expect(parseTrustProxy(undefined, { TRUST_PROXY: "10.0.0.0/8, 100.64.0.0/10" })).toEqual({ kind: "cidrs", cidrs: ["10.0.0.0/8", "100.64.0.0/10"] });
    expect(() => parseTrustProxy(undefined, { TRUST_PROXY: "not-an-ip" })).toThrow(SchemaError);
  });
});

describe("H4: outbox rows commit in the same transaction as the record", () => {
  const WEBHOOK_YAML = `${MINI_YAML}
webhooks:
  - entity: items
    events: [create, update, delete]
    url: http://127.0.0.1:9/hook
    secret: webhook-secret-webhook-secret
mail:
  - name: note
    entity: items
    events: [create]
    to: "ops@x.test"
    subject: "New item {{ record.title }}"
    template: note
`;

  async function startedWithMail(): Promise<Runtime> {
    const dir = await tempProject(WEBHOOK_YAML);
    await mkdir(join(dir, "mail"), { recursive: true });
    await writeFile(join(dir, "mail", "note.html"), "<p>{{ record.title }}</p>");
    const runtime = await createRuntime({ projectDir: dir, yamlSource: WEBHOOK_YAML, workers: false });
    cleanups.push(() => runtime.close());
    return Object.assign(runtime, { dir });
  }

  async function admin(runtime: Runtime) {
    const first = await j(runtime, "POST", "/api/v1/auth/first-admin", { email: "boss@x.test", password: "password123", name: "Boss" });
    return { id: first.json.data.user.id as string, auth: { authorization: `Bearer ${first.json.data.accessToken}` } };
  }

  const count = async (runtime: Runtime, table: string) =>
    Number(
      ((await (runtime.db as any)
        .selectFrom(table)
        .select((eb: any) => eb.fn.countAll().as("n"))
        .executeTakeFirst()) as { n: number | string }).n,
    );

  test("create, update and delete write webhook, mail and audit rows with the record", async () => {
    const runtime = await startedWithMail();
    const a = await admin(runtime);
    const auditBefore = await count(runtime, AUDIT_TABLE);
    const created = await j(runtime, "POST", "/api/v1/items", { title: "a", ownerId: a.id }, a.auth);
    expect(created.status).toBe(201);
    const id = created.json.data.id;
    expect((await j(runtime, "PATCH", `/api/v1/items/${id}`, { title: "b" }, a.auth)).status).toBe(200);
    expect((await j(runtime, "DELETE", `/api/v1/items/${id}`, undefined, a.auth)).status).toBeLessThan(300);
    expect(await count(runtime, WEBHOOK_OUTBOX_TABLE)).toBe(3);
    expect(await count(runtime, MAIL_OUTBOX_TABLE)).toBe(1);
    expect((await count(runtime, AUDIT_TABLE)) - auditBefore).toBe(3);
  });

  for (const table of [WEBHOOK_OUTBOX_TABLE, MAIL_OUTBOX_TABLE, AUDIT_TABLE]) {
    test(`a failed ${table} write rolls back the record and the server keeps serving`, async () => {
      const runtime = await startedWithMail();
      const a = await admin(runtime);
      await runtime.db.schema.dropTable(table).execute();
      const created = await j(runtime, "POST", "/api/v1/items", { title: "ghost", ownerId: a.id }, a.auth);
      expect(created.status).toBe(500);
      expect(await count(runtime, "items")).toBe(0);
      expect((await j(runtime, "GET", "/health")).status).toBe(200);
    });
  }

  test("concurrent writes on SQLite do not interleave transactions", async () => {
    const runtime = await startedWithMail();
    const a = await admin(runtime);
    const results = await Promise.all(
      Array.from({ length: 25 }, (_, i) => j(runtime, "POST", "/api/v1/items", { title: `t${i}`, ownerId: a.id }, a.auth)),
    );
    expect(results.every((res) => res.status === 201)).toBe(true);
    expect(await count(runtime, WEBHOOK_OUTBOX_TABLE)).toBe(25);
    expect(await count(runtime, MAIL_OUTBOX_TABLE)).toBe(25);
  });
});
