// The optional MCP dev server: off by default, admin or BAKORIN_MCP_TOKEN only,
// read only tools, audit logged, origin checked.
import { afterEach, describe, expect, test } from "bun:test";
import { resetRateLimit } from "@bakorin/server";
import { boot, MINI_YAML } from "./helpers.ts";

const cleanups: Array<() => Promise<unknown> | unknown> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

const MCP_YAML = MINI_YAML.replace("  hooks: ./hooks.ts\n", "  hooks: ./hooks.ts\n  mcp:\n    enabled: true\n    sampleLimit: 2\n");
const MCP_TOKEN = "mcp-test-token-0123456789-abcdefghijklmnop";

type Runtime = Awaited<ReturnType<typeof boot>>;

async function started(yaml = MCP_YAML, env: Record<string, string> = {}) {
  resetRateLimit();
  const saved: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env)) {
    saved[key] = process.env[key];
    process.env[key] = value;
  }
  try {
    const runtime = await boot(yaml);
    cleanups.push(() => runtime.close());
    return runtime;
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function admin(runtime: Runtime) {
  const res = await runtime.app.request("/api/v1/auth/first-admin", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "boss@example.test", password: "password123", name: "Boss" }),
  });
  const body = (await res.json()) as { data: { user: { id: string }; accessToken: string } };
  return { id: body.data.user.id, token: body.data.accessToken };
}

async function rpc(runtime: Runtime, token: string | null, payload: unknown, headers: Record<string, string> = {}) {
  const res = await runtime.app.request("/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

const call = (id: number, name: string, args: Record<string, unknown> = {}) => ({
  jsonrpc: "2.0",
  id,
  method: "tools/call",
  params: { name, arguments: args },
});

describe("mcp dev server", () => {
  test("off by default", async () => {
    const runtime = await started(MINI_YAML);
    const boss = await admin(runtime);
    expect(runtime.ast.runtime.mcp.enabled).toBe(false);
    expect((await rpc(runtime, boss.token, { jsonrpc: "2.0", id: 1, method: "ping" })).status).toBe(404);
  });

  test("needs an admin token, refuses users and anonymous callers, and audits refusals", async () => {
    const runtime = await started();
    await admin(runtime);
    expect((await rpc(runtime, null, { jsonrpc: "2.0", id: 1, method: "ping" })).status).toBe(401);
    await runtime.app.request("/api/v1/auth/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "pat@example.test", password: "password123", name: "Pat" }),
    });
    const login = await runtime.app.request("/api/v1/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "pat@example.test", password: "password123" }),
    });
    const userToken = ((await login.json()) as { data: { accessToken: string } }).data.accessToken;
    const denied = await rpc(runtime, userToken, { jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(denied.status).toBe(401);
    expect(denied.json.error.code).toBe(-32001);
    // A short or wrong MCP token is not accepted either.
    expect((await rpc(runtime, "short", { jsonrpc: "2.0", id: 1, method: "ping" })).status).toBe(401);
    const rows = await runtime.db.selectFrom("_bakorin_audit").select("action").where("action", "=", "mcp.denied").execute();
    expect(rows.length).toBe(3);
  });

  test("initialize, tools/list, notifications, batches, and GET", async () => {
    const runtime = await started();
    const boss = await admin(runtime);
    const init = await rpc(runtime, boss.token, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "1" } },
    });
    expect(init.status).toBe(200);
    expect(init.json.result.protocolVersion).toBe("2025-03-26");
    expect(init.json.result.capabilities.tools).toBeTruthy();
    expect(init.json.result.serverInfo.name).toBe("bakorin");
    const unknownVersion = await rpc(runtime, boss.token, { jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "1999-01-01" } });
    expect(unknownVersion.json.result.protocolVersion).toBe("2025-06-18");

    const note = await runtime.app.request("/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${boss.token}` },
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    });
    expect(note.status).toBe(202);

    const list = await rpc(runtime, boss.token, { jsonrpc: "2.0", id: 3, method: "tools/list" });
    const names = list.json.result.tools.map((tool: { name: string }) => tool.name);
    expect(names).toEqual(["app_overview", "list_entities", "describe_entity", "list_policies", "get_openapi", "get_typescript_types", "sample_records"]);
    for (const tool of list.json.result.tools) {
      expect(tool.annotations.readOnlyHint).toBe(true);
      expect(tool.inputSchema.type).toBe("object");
    }

    const batch = await rpc(runtime, boss.token, [
      { jsonrpc: "2.0", id: 4, method: "ping" },
      { jsonrpc: "2.0", id: 5, method: "resources/list" },
    ]);
    expect(batch.json).toHaveLength(2);
    expect(batch.json[0].result).toEqual({});
    expect(batch.json[1].error.code).toBe(-32601);

    const get = await runtime.app.request("/mcp", { headers: { authorization: `Bearer ${boss.token}` } });
    expect(get.status).toBe(405);
    const bad = await runtime.app.request("/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${boss.token}` },
      body: "{not json",
    });
    expect(bad.status).toBe(400);
  });

  test("every tool answers, secrets stay out, and calls are audit logged", async () => {
    const runtime = await started();
    const boss = await admin(runtime);
    for (const title of ["Paint the fence", "Feed the cat", "Call the plumber"]) {
      await runtime.app.request("/api/v1/items", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${boss.token}` },
        body: JSON.stringify({ title, ownerId: boss.id }),
      });
    }
    const overview = await rpc(runtime, boss.token, call(1, "app_overview"));
    expect(overview.json.result.isError).toBe(false);
    expect(overview.json.result.structuredContent.app.name).toBe("mini");

    const entities = await rpc(runtime, boss.token, call(2, "list_entities"));
    const entityNames = entities.json.result.structuredContent.items.map((item: { name: string }) => item.name);
    expect(entityNames).toEqual(expect.arrayContaining(["users", "items"]));

    const described = await rpc(runtime, boss.token, call(3, "describe_entity", { entity: "items" }));
    expect(JSON.stringify(described.json.result.structuredContent)).toContain("ownerId");
    const missing = await rpc(runtime, boss.token, call(4, "describe_entity", { entity: "nope" }));
    expect(missing.json.result.isError).toBe(true);

    const policies = await rpc(runtime, boss.token, call(5, "list_policies"));
    expect(JSON.stringify(policies.json.result.structuredContent)).toContain("owner(ownerId)");

    const openapi = await rpc(runtime, boss.token, call(6, "get_openapi"));
    expect(openapi.json.result.structuredContent.openapi).toMatch(/^3\./);

    const types = await rpc(runtime, boss.token, call(7, "get_typescript_types"));
    expect(types.json.result.content[0].text).toContain("items");

    const samples = await rpc(runtime, boss.token, call(8, "sample_records", { entity: "items", limit: 50 }));
    expect(samples.json.result.structuredContent.limit).toBe(2);
    expect(samples.json.result.structuredContent.records).toHaveLength(2);
    const users = await rpc(runtime, boss.token, call(9, "sample_records", { entity: "users" }));
    expect(JSON.stringify(users.json.result)).not.toContain("password");
    expect(JSON.stringify(users.json.result)).not.toContain("$argon");

    const unknown = await rpc(runtime, boss.token, call(10, "drop_tables"));
    expect(unknown.json.error.code).toBe(-32602);

    const audit = await runtime.db.selectFrom("_bakorin_audit").selectAll().where("action", "=", "mcp.call").execute();
    expect(audit.length).toBe(9);
    expect(audit.every((row) => row.actor_id === boss.id)).toBe(true);
    expect(audit.map((row) => JSON.parse(String(row.meta)).tool)).toContain("sample_records");
  });

  test("BAKORIN_MCP_TOKEN works for editors, BAKORIN_MCP turns it on, and foreign origins are refused", async () => {
    const runtime = await started(MINI_YAML, { BAKORIN_MCP: "true", BAKORIN_MCP_TOKEN: MCP_TOKEN });
    expect(runtime.ast.runtime.mcp.enabled).toBe(true);
    const list = await rpc(runtime, MCP_TOKEN, { jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(list.status).toBe(200);
    const sample = await rpc(runtime, MCP_TOKEN, call(2, "list_entities"));
    expect(sample.json.result.isError).toBe(false);
    const audit = await runtime.db.selectFrom("_bakorin_audit").selectAll().where("action", "=", "mcp.call").execute();
    expect(JSON.parse(String(audit[0]!.meta)).via).toBe("mcp_token");
    const foreign = await rpc(runtime, MCP_TOKEN, { jsonrpc: "2.0", id: 3, method: "ping" }, { origin: "https://evil.example" });
    expect(foreign.status).toBe(403);
    const wrong = await rpc(runtime, `${MCP_TOKEN}x`, { jsonrpc: "2.0", id: 4, method: "ping" });
    expect(wrong.status).toBe(401);
  });
});
