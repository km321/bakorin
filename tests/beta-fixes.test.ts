// Regression tests for the pre-beta fixes: M9, M10, and the Low findings.
import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { join } from "node:path";
import { compileAppYaml } from "@bakorin/core";
import { clearLoggedMail, createRuntime, getLoggedMail } from "@bakorin/server";
import { importAppYaml, toAppYaml } from "../packages/core/src/builder.ts";
import { consumeAuthToken, issueAuthToken } from "../packages/server/src/auth/tokens.ts";
import { boot, MINI_YAML, tempProject, waitForLoggedToken } from "./helpers.ts";

const STRONG = "beta-fixes-secret-9f8e7d6c5b4a3210-ZYXWVUTSRQ";

const cleanups: Array<() => Promise<unknown> | unknown> = [];
afterEach(async () => {
  while (cleanups.length) {
    await cleanups.pop()!();
  }
});

type Runtime = Awaited<ReturnType<typeof boot>>;

async function started(yaml?: string, hooks?: string): Promise<Runtime> {
  const runtime = await boot(yaml, hooks);
  cleanups.push(() => runtime.close());
  return runtime;
}

async function j(
  runtime: { app: { fetch: (request: Request) => Response | Promise<Response> } },
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  const res = await runtime.app.fetch(
    new Request(`http://x${path}`, {
      method,
      headers: { "content-type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    // empty body
  }
  return { status: res.status, json, headers: res.headers };
}

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
const from = (ip: string) => ({ "x-forwarded-for": ip });

/** Signup never returns a session, so sign up and then log in (unless signup refused). */
async function signup(runtime: Parameters<typeof j>[0], email: string, headers: Record<string, string> = {}) {
  const res = await j(runtime, "POST", "/api/v1/auth/signup", { email, password: "password123", name: email.split("@")[0] }, headers);
  if (res.status !== 202) {
    return res;
  }
  return j(runtime, "POST", "/api/v1/auth/login", { email, password: "password123" }, headers);
}

const TRUSTED = MINI_YAML.replace("  hooks: ./hooks.ts\n", "  hooks: ./hooks.ts\n  trustProxy: 1\n");

const LEADS_YAML = TRUSTED.replace(
  "  items:\n",
  `  leads:
    fields:
      email: { type: email, required: true }
    policies:
      read: admin
      create: public
      update: admin
      delete: admin
    rateLimit:
      create: { limit: 2, window: 1m }
  items:
    rateLimit:
      update: { limit: 1, window: 10m, per: user }
`,
);

describe("M9: per entity rateLimit in app.yaml", () => {
  test("windows compile to seconds and bad config gets a friendly error", () => {
    const ast = compileAppYaml(LEADS_YAML);
    expect(ast.entityMap.leads!.rateLimit).toEqual({ create: { limit: 2, windowSeconds: 60, per: "ip" } });
    expect(ast.entityMap.items!.rateLimit).toEqual({ update: { limit: 1, windowSeconds: 600, per: "user" } });
    expect(() => compileAppYaml(LEADS_YAML.replace("window: 1m }", "window: 1 minute }"))).toThrow(
      /window like 30s, 10m, 1h, or 1d/,
    );
    expect(() => compileAppYaml(LEADS_YAML.replace("limit: 2,", "limit: 0,"))).toThrow(/rateLimit/);
    expect(() => compileAppYaml(LEADS_YAML.replace("    rateLimit:\n      create:", "    rateLimit:\n      list:"))).toThrow(
      /unknown key "list"/,
    );
    expect(() => compileAppYaml(LEADS_YAML.replace("window: 1m }", "window: 8d }"))).toThrow(/7 days/);
  });

  test("public creates are limited per client IP with a 429 and Retry-After", async () => {
    const runtime = await started(LEADS_YAML);
    for (let i = 0; i < 2; i++) {
      expect((await j(runtime, "POST", "/api/v1/leads", { email: `a${i}@x.test` }, from("203.0.113.5"))).status).toBe(201);
    }
    const third = await j(runtime, "POST", "/api/v1/leads", { email: "a3@x.test" }, from("203.0.113.5"));
    expect(third.status).toBe(429);
    expect(third.json.error.code).toBe("rate_limited");
    expect(third.headers.get("retry-after")).toBe("60");
    expect((await j(runtime, "POST", "/api/v1/leads", { email: "b@x.test" }, from("203.0.113.6"))).status).toBe(201);
  });

  test("per: user counts each signed in user separately, whatever their IP", async () => {
    const runtime = await started(LEADS_YAML);
    const a = (await signup(runtime, "ua@x.test", from("198.51.100.1"))).json.data;
    const b = (await signup(runtime, "ub@x.test", from("198.51.100.2"))).json.data;
    const itemA = (await j(runtime, "POST", "/api/v1/items", { title: "A" }, bearer(a.accessToken))).json.data;
    const itemB = (await j(runtime, "POST", "/api/v1/items", { title: "B" }, bearer(b.accessToken))).json.data;
    const patch = (token: string, id: string, ip: string) =>
      j(runtime, "PATCH", `/api/v1/items/${id}`, { done: true }, { ...bearer(token), ...from(ip) });
    expect((await patch(a.accessToken, itemA.id, "10.0.0.1")).status).toBe(200);
    expect((await patch(a.accessToken, itemA.id, "10.0.0.2")).status).toBe(429);
    expect((await patch(b.accessToken, itemB.id, "10.0.0.1")).status).toBe(200);
  });

  test("uploads honor runtime.files.rateLimit", async () => {
    const yaml = TRUSTED.replace("    path: ./data/uploads\n", "    path: ./data/uploads\n    rateLimit: { limit: 1, window: 1h }\n");
    const runtime = await started(yaml);
    const user = (await signup(runtime, "up@x.test")).json.data;
    const upload = async () => {
      const form = new FormData();
      form.set("file", new File(["hello"], "a.txt", { type: "text/plain" }));
      return runtime.app.fetch(
        new Request("http://x/api/v1/files", { method: "POST", headers: bearer(user.accessToken), body: form }),
      );
    };
    expect((await upload()).status).toBe(201);
    expect((await upload()).status).toBe(429);
  });

  test("the builder keeps rateLimit through import and export", () => {
    const imported = importAppYaml(LEADS_YAML);
    const leads = imported.config.entities.find((entity) => entity.name === "leads")!;
    expect(leads.rateLimit.create).toEqual({ limit: "2", window: "1m", per: "" });
    const out = compileAppYaml(toAppYaml(imported.config));
    expect(out.entityMap.leads!.rateLimit).toEqual({ create: { limit: 2, windowSeconds: 60, per: "ip" } });
    expect(out.entityMap.items!.rateLimit?.update?.per).toBe("user");
  });
});

const VERIFY_HOOKS = `
export default {
  entities: {},
  verify(ctx) {
    globalThis.__verifySeen = [...(globalThis.__verifySeen ?? []), ctx.action + ":" + ctx.entity];
    if (ctx.token === "boom") throw new Error("provider down");
    if (ctx.token === "good") return true;
    return { ok: false, message: "complete the captcha" };
  },
};
`;

describe("M9: captcha verify hook", () => {
  test("signup and signed out creates need the hook to pass; signed in creates skip it", async () => {
    (globalThis as any).__verifySeen = [];
    const runtime = await started(LEADS_YAML.replace("limit: 2, window: 1m", "limit: 100, window: 1m"), VERIFY_HOOKS);
    const blocked = await signup(runtime, "v@x.test");
    expect(blocked.status).toBe(403);
    expect(blocked.json.error).toEqual({ code: "verification_failed", message: "complete the captcha" });
    const okSignup = await signup(runtime, "v@x.test", { "x-bakorin-verify": "good" });
    expect(okSignup.status).toBe(200);

    expect((await j(runtime, "POST", "/api/v1/leads", { email: "l@x.test" })).status).toBe(403);
    expect((await j(runtime, "POST", "/api/v1/leads", { email: "l@x.test" }, { "x-bakorin-verify": "good" })).status).toBe(201);
    const thrown = await j(runtime, "POST", "/api/v1/leads", { email: "l@x.test" }, { "x-bakorin-verify": "boom" });
    expect(thrown.status).toBe(403);
    expect(thrown.json.error.code).toBe("verification_failed");

    const before = (globalThis as any).__verifySeen.length;
    const item = await j(runtime, "POST", "/api/v1/items", { title: "mine" }, bearer(okSignup.json.data.accessToken));
    expect(item.status).toBe(201);
    expect((globalThis as any).__verifySeen.length).toBe(before);
    expect((globalThis as any).__verifySeen).toContain("signup:users");
    expect((globalThis as any).__verifySeen).toContain("create:leads");
  });

  test("CORS lets browsers send the X-Bakorin-Verify header", async () => {
    const runtime = await started(LEADS_YAML);
    const res = await runtime.app.fetch(
      new Request("http://x/api/v1/leads", {
        method: "OPTIONS",
        headers: { origin: "http://localhost:5173", "access-control-request-method": "POST", "access-control-request-headers": "x-bakorin-verify" },
      }),
    );
    expect((res.headers.get("access-control-allow-headers") ?? "").toLowerCase()).toContain("x-bakorin-verify");
  });
});

async function productionRuntime(extraEnv: Record<string, string> = {}) {
  const dir = await tempProject(MINI_YAML);
  const lines: string[] = [];
  const spy = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  });
  try {
    const runtime = await createRuntime({
      projectDir: dir,
      yamlSource: await Bun.file(join(dir, "app.yaml")).text(),
      env: { BAKORIN_ENV: "production", JWT_SECRET: STRONG, CORS_ORIGINS: "http://localhost", ...extraEnv },
      workers: false,
    });
    cleanups.push(() => runtime.close());
    return { runtime, lines };
  } finally {
    spy.mockRestore();
  }
}

const ADMIN = { email: "boss@x.test", password: "password123", name: "Boss" };

describe("M10: first admin in production", () => {
  test("needs the one time setup token printed to the log", async () => {
    const { runtime, lines } = await productionRuntime();
    const tokenLine = lines.find((line) => line.includes("setup token:"));
    expect(tokenLine).toBeTruthy();
    const token = tokenLine!.split("setup token: ")[1]!.trim();
    expect((await j(runtime, "GET", "/api/v1/auth/setup")).json.data).toMatchObject({ firstAdmin: true, setupTokenRequired: true });

    const none = await j(runtime, "POST", "/api/v1/auth/first-admin", ADMIN);
    expect(none.status).toBe(403);
    expect(none.json.error.code).toBe("setup_token_required");
    expect((await j(runtime, "POST", "/api/v1/auth/first-admin", { ...ADMIN, setupToken: "nope" })).status).toBe(403);

    const ok = await j(runtime, "POST", "/api/v1/auth/first-admin", { ...ADMIN, setupToken: token });
    expect(ok.status).toBe(201);
    expect((await j(runtime, "GET", "/api/v1/auth/setup")).json.data).toMatchObject({ firstAdmin: false, setupTokenRequired: false });
    const again = await j(runtime, "POST", "/api/v1/auth/first-admin", { ...ADMIN, email: "two@x.test", setupToken: token });
    expect(again.status).toBe(403);
  });

  test("the env seed skips the token entirely", async () => {
    const { runtime, lines } = await productionRuntime({ BAKORIN_ADMIN_EMAIL: "seed@x.test", BAKORIN_ADMIN_PASSWORD: "password123" });
    expect(lines.some((line) => line.includes("setup token:"))).toBe(false);
    expect((await j(runtime, "GET", "/api/v1/auth/setup")).json.data.firstAdmin).toBe(false);
  });

  test("dev mode keeps the open first admin form", async () => {
    const runtime = await started();
    expect((await j(runtime, "GET", "/api/v1/auth/setup")).json.data.setupTokenRequired).toBe(false);
    expect((await j(runtime, "POST", "/api/v1/auth/first-admin", ADMIN)).status).toBe(201);
  });
});

describe("L4: one time tokens are consumed atomically", () => {
  test("parallel consumes of one token succeed once", async () => {
    const runtime = await started();
    const token = await issueAuthToken(runtime.context.db, { email: "x@x.test", purpose: "reset", ttlSeconds: 600 });
    const results = await Promise.all(Array.from({ length: 6 }, () => consumeAuthToken(runtime.context.db, token, "reset")));
    expect(results.filter(Boolean)).toHaveLength(1);
  });
});

describe("L1: dev reload picks up hooks.ts and CORS changes", () => {
  test("after hooks and CORS origins follow a reload", async () => {
    const hooks = (tag: string) =>
      `export default { entities: { items: { afterCreate() { globalThis.__hookTag = "${tag}"; } } } };\n`;
    const yaml = (origin: string) =>
      MINI_YAML.replace("  hooks: ./hooks.ts\n", `  hooks: ./hooks.ts\n  cors:\n    origins: ["${origin}"]\n`);
    const runtime = await started(yaml("http://one.test"), hooks("v1"));
    const user = (await signup(runtime, "h@x.test")).json.data;
    await j(runtime, "POST", "/api/v1/items", { title: "a" }, bearer(user.accessToken));
    await Bun.sleep(20);
    expect((globalThis as any).__hookTag).toBe("v1");

    await Bun.write(join(runtime.dir, "hooks.ts"), hooks("v2"));
    // Reload the file boot wrote (it may have been rewritten for Postgres).
    const current = await Bun.file(join(runtime.dir, "app.yaml")).text();
    await runtime.reload(current.replace("http://one.test", "http://two.test"));
    await j(runtime, "POST", "/api/v1/items", { title: "b" }, bearer(user.accessToken));
    await Bun.sleep(20);
    expect((globalThis as any).__hookTag).toBe("v2");

    const preflight = await runtime.app.fetch(
      new Request("http://x/api/v1/items", {
        method: "OPTIONS",
        headers: { origin: "http://two.test", "access-control-request-method": "POST" },
      }),
    );
    expect(preflight.headers.get("access-control-allow-origin")).toBe("http://two.test");
  });
});

describe("L3: signup does not reveal whether an email is registered", () => {
  const body = (email: string, password = "password123") => ({ email, password, name: "Someone" });

  test("a new and an existing email get the same status and body, and neither gets a session", async () => {
    const runtime = await started(TRUSTED);
    clearLoggedMail();
    const fresh = await j(runtime, "POST", "/api/v1/auth/signup", body("taken@x.test"), from("198.51.100.1"));
    const again = await j(runtime, "POST", "/api/v1/auth/signup", body("Taken@X.test", "another-pass-1"), from("198.51.100.2"));
    expect(fresh.status).toBe(202);
    expect(again.status).toBe(202);
    expect(again.json).toEqual(fresh.json);
    expect(fresh.json.data).toEqual({
      ok: true,
      status: "check_email",
      requiresVerification: false,
      message: "Check your email to confirm your address. You can sign in now.",
    });
    expect(JSON.stringify(fresh.json)).not.toMatch(/accessToken|refreshToken|"user"/);
    const rows = await runtime.db.selectFrom("users").select(["id", "password"]).where("email", "=", "taken@x.test").execute();
    expect(rows.length).toBe(1);
    // The second attempt did not change the password.
    expect((await j(runtime, "POST", "/api/v1/auth/login", { email: "taken@x.test", password: "password123" })).status).toBe(200);
    expect((await j(runtime, "POST", "/api/v1/auth/login", { email: "taken@x.test", password: "another-pass-1" })).status).toBe(401);
  });

  test("the account holder gets a notice with a working reset link, at most once an hour", async () => {
    const runtime = await started(TRUSTED);
    await j(runtime, "POST", "/api/v1/auth/signup", body("owner@x.test"), from("198.51.100.3"));
    clearLoggedMail();
    await j(runtime, "POST", "/api/v1/auth/signup", body("owner@x.test", "attacker-pass-1"), from("198.51.100.4"));
    const token = await waitForLoggedToken("existing");
    const notice = getLoggedMail().find((mail) => mail.meta?.purpose === "existing")!;
    expect(notice.to).toEqual(["owner@x.test"]);
    expect(notice.subject).toBe("Someone tried to sign up for mini with your email");
    expect(notice.text).toContain("/reset-password?token=");
    expect(notice.text).not.toMatch(/[\u2013\u2014]/);
    const audit = await runtime.db.selectFrom("_bakorin_audit").select("action").where("action", "=", "signup_existing").execute();
    expect(audit.length).toBe(1);

    await j(runtime, "POST", "/api/v1/auth/signup", body("owner@x.test", "attacker-pass-2"), from("198.51.100.5"));
    await Bun.sleep(200);
    expect(getLoggedMail().filter((mail) => mail.meta?.purpose === "existing").length).toBe(1);

    const reset = await j(runtime, "POST", "/api/v1/auth/reset-password", { token, password: "owner-new-pass-1" });
    expect(reset.status).toBe(200);
    expect((await j(runtime, "POST", "/api/v1/auth/login", { email: "owner@x.test", password: "owner-new-pass-1" })).status).toBe(200);
  });

  test("validation answers the same for new and existing emails", async () => {
    const runtime = await started(TRUSTED);
    await j(runtime, "POST", "/api/v1/auth/signup", body("v3@x.test"), from("198.51.100.6"));
    const missingNew = await j(runtime, "POST", "/api/v1/auth/signup", { email: "new3@x.test", password: "password123" }, from("198.51.100.7"));
    const missingOld = await j(runtime, "POST", "/api/v1/auth/signup", { email: "v3@x.test", password: "password123" }, from("198.51.100.8"));
    expect(missingNew.status).toBe(400);
    expect(missingOld.status).toBe(missingNew.status);
    expect(missingOld.json).toEqual(missingNew.json);
  });

  test("two signups for one email at once both answer 202 and create one row", async () => {
    const runtime = await started(TRUSTED);
    const results = await Promise.all(
      [1, 2, 3].map((i) => j(runtime, "POST", "/api/v1/auth/signup", body("race@x.test"), from(`198.51.100.${20 + i}`))),
    );
    expect(results.map((r) => r.status)).toEqual([202, 202, 202]);
    const rows = await runtime.db.selectFrom("users").select("id").where("email", "=", "race@x.test").execute();
    expect(rows.length).toBe(1);
  });

  test("with requireVerifiedEmail the message says to confirm first", async () => {
    const yaml = TRUSTED.replace("auth:\n  entity: users\n  adminRole: admin", "auth:\n  entity: users\n  adminRole: admin\n  requireVerifiedEmail: true");
    const runtime = await started(yaml);
    const res = await j(runtime, "POST", "/api/v1/auth/signup", body("rv@x.test"), from("198.51.100.30"));
    expect(res.status).toBe(202);
    expect(res.json.data.requiresVerification).toBe(true);
    expect(res.json.data.message).toBe("Check your email to confirm your address, then sign in.");
  });
});

describe("L3 and L5: login lockouts", () => {
  const login = (runtime: Runtime, email: string, ip: string, password = "wrong-password") =>
    j(runtime, "POST", "/api/v1/auth/login", { email, password }, from(ip));

  test("an unknown email locks the same way as a known one", async () => {
    const runtime = await started(TRUSTED);
    await signup(runtime, "known@x.test");
    const statuses = async (email: string, ip: string) => {
      const out: number[] = [];
      for (let i = 0; i < 6; i++) out.push((await login(runtime, email, ip)).status);
      return out;
    };
    const known = await statuses("known@x.test", "192.0.2.10");
    const unknown = await statuses("nobody@x.test", "192.0.2.11");
    expect(unknown).toEqual(known);
    expect(known.at(-1)).toBe(429);
  });

  test("failures from one IP do not lock the owner out from another", async () => {
    const runtime = await started(TRUSTED);
    await signup(runtime, "owner@x.test");
    for (let i = 0; i < 6; i++) await login(runtime, "owner@x.test", "192.0.2.20");
    expect((await login(runtime, "owner@x.test", "192.0.2.20", "password123")).status).toBe(429);
    expect((await login(runtime, "owner@x.test", "192.0.2.21", "password123")).status).toBe(200);
  });
});

describe("L7: API docs are admin only in production", () => {
  test("production defaults to admin, dev to public, and runtime.apiDocs or BAKORIN_API_DOCS override", async () => {
    expect(compileAppYaml(MINI_YAML, { env: { JWT_SECRET: STRONG } }).runtime.apiDocs).toBe("admin");
    expect(compileAppYaml(MINI_YAML, { env: { BAKORIN_ENV: "development" } }).runtime.apiDocs).toBe("public");
    expect(compileAppYaml(MINI_YAML, { env: { JWT_SECRET: STRONG, BAKORIN_API_DOCS: "public" } }).runtime.apiDocs).toBe("public");
    const yaml = MINI_YAML.replace("  hooks: ./hooks.ts\n", "  hooks: ./hooks.ts\n  apiDocs: admin\n");
    expect(compileAppYaml(yaml).runtime.apiDocs).toBe("admin");
    expect(() => compileAppYaml(MINI_YAML, { env: { BAKORIN_API_DOCS: "everyone", BAKORIN_ENV: "development" } })).toThrow(
      /BAKORIN_API_DOCS/,
    );
  });

  test("the spec needs an admin token when apiDocs is admin", async () => {
    const runtime = await started(MINI_YAML.replace("  hooks: ./hooks.ts\n", "  hooks: ./hooks.ts\n  apiDocs: admin\n"));
    expect((await j(runtime, "GET", "/api/v1/openapi.json")).status).toBe(401);
    const admin = (await j(runtime, "POST", "/api/v1/auth/first-admin", ADMIN)).json.data;
    const member = (await signup(runtime, "m@x.test")).json.data;
    expect((await j(runtime, "GET", "/api/v1/openapi.json", undefined, bearer(member.accessToken))).status).toBe(403);
    const ok = await j(runtime, "GET", "/api/v1/openapi.json", undefined, bearer(admin.accessToken));
    expect(ok.status).toBe(200);
    expect(ok.json.openapi).toBeTruthy();
    expect((await runtime.app.fetch(new Request("http://x/docs"))).status).toBe(200);
  });
});

describe("L8: restoring does not have to replay production deliveries", () => {
  test("pending webhook and mail rows can be counted and discarded", async () => {
    const { countPendingDeliveries, discardPendingDeliveries } = await import("@bakorin/server");
    const yaml = MINI_YAML.replace(
      "entities:\n",
      "webhooks:\n  - entity: items\n    events: [create]\n    url: http://127.0.0.1:9/hook\nentities:\n",
    );
    const dir = await tempProject(yaml);
    const runtime = await createRuntime({ projectDir: dir, yamlSource: yaml, workers: false });
    cleanups.push(() => runtime.close());
    const user = (await signup(runtime, "p@x.test")).json.data;
    await j(runtime, "POST", "/api/v1/items", { title: "queued" }, bearer(user.accessToken));
    const before = await countPendingDeliveries(runtime.db);
    expect(before.webhooks).toBe(1);
    const dropped = await discardPendingDeliveries(runtime.db);
    expect(dropped).toEqual(before);
    expect(await countPendingDeliveries(runtime.db)).toEqual({ webhooks: 0, mail: 0 });
  });
});

describe("L9: database constraint errors are client errors", () => {
  test("unique and restrict violations return 409, not 500", async () => {
    const yaml = MINI_YAML.replace(
      "  items:\n",
      `  codes:
    fields:
      code: { type: text, unique: true, required: true }
    policies:
      read: public
      create: public
      update: admin
      delete: admin
  items:
`,
    );
    const runtime = await started(yaml);
    expect((await j(runtime, "POST", "/api/v1/codes", { code: "A1" })).status).toBe(201);
    const dupe = await j(runtime, "POST", "/api/v1/codes", { code: "A1" });
    expect(dupe.status).toBe(409);
    expect(dupe.json.error.code).toBe("conflict");

    const admin = (await j(runtime, "POST", "/api/v1/auth/first-admin", ADMIN)).json.data;
    const member = (await signup(runtime, "owner2@x.test")).json.data;
    await j(runtime, "POST", "/api/v1/items", { title: "kept" }, bearer(member.accessToken));
    const removed = await j(runtime, "DELETE", `/api/v1/users/${member.user.id}`, undefined, bearer(admin.accessToken));
    expect(removed.status).toBe(409);
    expect(removed.json.error.message).toMatch(/still reference/);
  });
});
