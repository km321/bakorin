// Regression tests for the pre-beta fixes: M9, M10, and the Low findings.
import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { join } from "node:path";
import { compileAppYaml } from "@bakorin/core";
import { createRuntime } from "@bakorin/server";
import { importAppYaml, toAppYaml } from "../packages/core/src/builder.ts";
import { consumeAuthToken, issueAuthToken } from "../packages/server/src/auth/tokens.ts";
import { boot, MINI_YAML, tempProject } from "./helpers.ts";

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

async function signup(runtime: Runtime, email: string, headers: Record<string, string> = {}) {
  return j(runtime, "POST", "/api/v1/auth/signup", { email, password: "password123", name: email.split("@")[0] }, headers);
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
    expect(okSignup.status).toBe(201);

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
