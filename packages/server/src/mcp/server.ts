import { timingSafeEqual } from "node:crypto";
import { Hono, type Context } from "hono";
import { describePolicy, generateTypes, type EntityAST, type SchemaAST } from "@bakorin/core";
import { buildOpenApi } from "../meta/openapi.ts";
import { writeAudit } from "../audit/log.ts";
import { clientIp } from "../http/client-ip.ts";
import { rateLimit } from "../auth/rate-limit.ts";
import { decodeRow } from "../crud/query.ts";
import { visibleRow } from "../crud/validate.ts";
import type { AppContext } from "../context.ts";
import { serverVersion } from "../version.ts";

/**
 * A read only Model Context Protocol server for development tools (Cursor, Claude).
 * Streamable HTTP transport, JSON responses only, no server initiated messages.
 * Off unless runtime.mcp or BAKORIN_MCP turns it on, and every call needs an admin.
 */

export const MCP_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"] as const;
/** Shortest BAKORIN_MCP_TOKEN accepted. */
export const MCP_TOKEN_MIN_LENGTH = 32;

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

interface ToolDef {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run: (ctx: AppContext, args: Record<string, unknown>) => Promise<unknown> | unknown;
}

class ToolError extends Error {}

function entityOrThrow(ast: SchemaAST, name: unknown): EntityAST {
  const entity = typeof name === "string" ? ast.entityMap[name] : undefined;
  if (!entity) {
    throw new ToolError(`unknown entity ${JSON.stringify(name)}. Known: ${ast.order.join(", ")}`);
  }
  return entity;
}

function policySummary(entity: EntityAST): Record<string, string[]> {
  return Object.fromEntries(
    (["read", "create", "update", "delete"] as const).map((action) => [action, entity.policies[action].map(describePolicy)]),
  );
}

function describeEntity(entity: EntityAST): Record<string, unknown> {
  return {
    name: entity.name,
    label: entity.label,
    plural: entity.plural,
    description: entity.description ?? null,
    auth: entity.auth,
    display: entity.display,
    realtime: entity.realtime ?? false,
    fields: entity.fields.map((field) => ({
      name: field.name,
      type: field.type,
      required: field.required,
      unique: field.unique,
      indexed: field.indexed,
      default: field.defaultValue ?? null,
      ...(field.enumValues ? { values: field.enumValues } : {}),
      ...(field.relation ? { relation: field.relation } : {}),
      private: field.private === true,
      secret: field.secret,
      writable: field.writable,
      ...(field.description ? { description: field.description } : {}),
    })),
    policies: policySummary(entity),
    indexes: entity.indexes,
    rateLimit: entity.rateLimit ?? null,
  };
}

const NO_ARGS = { type: "object", properties: {}, additionalProperties: false };
const ENTITY_ARG = {
  type: "object",
  properties: { entity: { type: "string", description: "Entity name from list_entities" } },
  required: ["entity"],
  additionalProperties: false,
};

export const MCP_TOOLS: ToolDef[] = [
  {
    name: "app_overview",
    title: "App overview",
    description: "App name and version, database dialect, auth settings, entities with record counts, and which features are on.",
    inputSchema: NO_ARGS,
    async run(ctx) {
      const ast = ctx.ast;
      const counts: Record<string, number> = {};
      for (const name of ast.order) {
        const row = (await ctx.db
          .selectFrom(name)
          .select((eb) => eb.fn.countAll().as("n"))
          .executeTakeFirst()) as { n?: unknown } | undefined;
        counts[name] = Number(row?.n ?? 0);
      }
      return {
        app: { name: ast.appName, version: ast.appVersion, description: ast.appDescription ?? null },
        server: { version: serverVersion(), dialect: ast.runtime.dialect },
        auth: {
          entity: ast.auth.entity,
          identityField: ast.auth.identityField,
          adminRole: ast.auth.adminRole,
          signup: ast.auth.signup,
          requireVerifiedEmail: ast.auth.requireVerifiedEmail,
        },
        entities: ast.order.map((name) => ({ name, records: counts[name] ?? 0, realtime: ast.entityMap[name]?.realtime ?? false })),
        features: {
          webhooks: ast.webhooks.length,
          mailRules: ast.mail.length,
          jobs: ast.jobs.length,
          realtimeEntities: ast.entities.filter((entity) => entity.realtime).map((entity) => entity.name),
          branding: Boolean(ast.branding),
          apiDocs: ast.runtime.apiDocs,
        },
      };
    },
  },
  {
    name: "list_entities",
    title: "List entities",
    description: "Every entity in app.yaml with its label, field names, read policy, and realtime mode.",
    inputSchema: NO_ARGS,
    run(ctx) {
      return ctx.ast.order.map((name) => {
        const entity = ctx.ast.entityMap[name]!;
        return {
          name,
          label: entity.label,
          auth: entity.auth,
          fields: entity.fields.map((field) => field.name),
          read: entity.policies.read.map(describePolicy),
          realtime: entity.realtime ?? false,
        };
      });
    },
  },
  {
    name: "describe_entity",
    title: "Describe an entity",
    description: "Fields with types, required, unique, defaults, enum values, relations, private and secret flags, plus policies, indexes, and rate limits.",
    inputSchema: ENTITY_ARG,
    run(ctx, args) {
      return describeEntity(entityOrThrow(ctx.ast, args.entity));
    },
  },
  {
    name: "list_policies",
    title: "List policies",
    description: "Read, create, update, and delete policies for every entity. Admins bypass all of them.",
    inputSchema: NO_ARGS,
    run(ctx) {
      return {
        adminRole: ctx.ast.auth.adminRole,
        entities: Object.fromEntries(ctx.ast.order.map((name) => [name, policySummary(ctx.ast.entityMap[name]!)])),
      };
    },
  },
  {
    name: "get_openapi",
    title: "OpenAPI document",
    description: "The generated OpenAPI 3.1 document for this app's REST API.",
    inputSchema: NO_ARGS,
    run(ctx) {
      return buildOpenApi(ctx.ast);
    },
  },
  {
    name: "get_typescript_types",
    title: "TypeScript types",
    description: "Generated TypeScript interfaces for every entity (the same output as bakorin types).",
    inputSchema: NO_ARGS,
    run(ctx) {
      return { typescript: generateTypes(ctx.ast) };
    },
  },
  {
    name: "sample_records",
    title: "Sample records",
    description: "The newest few records of an entity, as an admin sees them through the API. Secret fields such as password hashes are never included.",
    inputSchema: {
      type: "object",
      properties: {
        entity: { type: "string", description: "Entity name from list_entities" },
        limit: { type: "integer", minimum: 1, maximum: 50, description: "How many records (capped by runtime.mcp.sampleLimit)" },
      },
      required: ["entity"],
      additionalProperties: false,
    },
    async run(ctx, args) {
      const entity = entityOrThrow(ctx.ast, args.entity);
      const cap = ctx.ast.runtime.mcp.sampleLimit;
      const requested = typeof args.limit === "number" && Number.isInteger(args.limit) ? args.limit : cap;
      const limit = Math.max(1, Math.min(cap, requested));
      const rows = await ctx.db.selectFrom(entity.name).selectAll().orderBy("createdAt", "desc").limit(limit).execute();
      const admin = { id: "mcp", role: ctx.ast.auth.adminRole };
      return {
        entity: entity.name,
        limit,
        records: rows.map((row) => visibleRow(ctx.ast, entity, decodeRow(entity, row as Record<string, unknown>), admin)),
      };
    },
  },
];

function rpcResult(id: JsonRpcRequest["id"], result: unknown) {
  return { jsonrpc: "2.0", id: id ?? null, result };
}

function rpcError(id: JsonRpcRequest["id"], code: number, message: string) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

function tokenMatches(expected: string | undefined, given: string): boolean {
  if (!expected || expected.length < MCP_TOKEN_MIN_LENGTH) {
    return false;
  }
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Who is calling: an admin user's access token, or the BAKORIN_MCP_TOKEN. Null means refuse. */
function caller(c: Context, ctx: AppContext): { id: string | null; role: string; via: "admin_token" | "mcp_token" } | null {
  const actor = c.get("actor");
  if (actor && actor.role === ctx.ast.auth.adminRole) {
    return { id: actor.id, role: actor.role, via: "admin_token" };
  }
  const header = c.req.header("authorization") ?? "";
  if (header.startsWith("Bearer ") && tokenMatches(ctx.mcpToken, header.slice(7))) {
    return { id: null, role: ctx.ast.auth.adminRole, via: "mcp_token" };
  }
  return null;
}

/** Same rule the MCP spec asks for against DNS rebinding: a browser Origin must be ours or a CORS origin. */
function originAllowed(c: Context, ctx: AppContext): boolean {
  const origin = c.req.header("origin");
  if (!origin) {
    return true;
  }
  const self = new URL(c.req.url).origin;
  return origin === self || ctx.ast.runtime.corsOrigins.includes(origin);
}

async function handle(c: Context, ctx: AppContext, who: NonNullable<ReturnType<typeof caller>>, message: JsonRpcRequest) {
  const id = message.id;
  const isNotification = id === undefined;
  if (message.jsonrpc !== "2.0" || typeof message.method !== "string") {
    return isNotification ? null : rpcError(id, -32600, "invalid JSON-RPC request");
  }
  switch (message.method) {
    case "initialize": {
      const asked = String(message.params?.protocolVersion ?? "");
      const version = (MCP_PROTOCOL_VERSIONS as readonly string[]).includes(asked) ? asked : MCP_PROTOCOL_VERSIONS[0];
      return rpcResult(id, {
        protocolVersion: version,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "bakorin", title: `Bakorin: ${ctx.ast.appName}`, version: serverVersion() },
        instructions: `Read only tools for the ${ctx.ast.appName} Bakorin app: schema, entities and fields, policies, OpenAPI, TypeScript types, and a few sample records. Nothing here can change data.`,
      });
    }
    case "ping":
      return isNotification ? null : rpcResult(id, {});
    case "tools/list":
      return rpcResult(id, {
        tools: MCP_TOOLS.map((tool) => ({
          name: tool.name,
          title: tool.title,
          description: tool.description,
          inputSchema: tool.inputSchema,
          annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        })),
      });
    case "tools/call": {
      const name = String(message.params?.name ?? "");
      const args = (message.params?.arguments ?? {}) as Record<string, unknown>;
      const tool = MCP_TOOLS.find((item) => item.name === name);
      if (!tool) {
        return rpcError(id, -32602, `unknown tool ${JSON.stringify(name)}`);
      }
      await writeAudit(ctx.db, {
        action: "mcp.call",
        actorId: who.id ?? undefined,
        actorRole: who.role,
        entity: typeof args.entity === "string" ? args.entity : undefined,
        ip: clientIp(c),
        meta: { tool: name, via: who.via },
      });
      try {
        const data = await tool.run(ctx, args);
        return rpcResult(id, {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
          structuredContent: Array.isArray(data) ? { items: data } : data,
          isError: false,
        });
      } catch (error) {
        if (error instanceof ToolError) {
          return rpcResult(id, { content: [{ type: "text", text: error.message }], isError: true });
        }
        ctx.monitor.captureError(error, { source: "mcp" });
        return rpcResult(id, { content: [{ type: "text", text: "the tool failed on the server" }], isError: true });
      }
    }
    default:
      if (isNotification) {
        return null;
      }
      return rpcError(id, -32601, `method ${message.method} is not supported`);
  }
}

export function createMcpRoutes(): Hono {
  const app = new Hono();
  app.all("/", async (c) => {
    const ctx = c.get("app");
    if (!ctx.ast.runtime.mcp.enabled) {
      return c.json({ error: { code: "not_found", message: "the MCP server is off. Set runtime.mcp: true or BAKORIN_MCP=true" } }, 404);
    }
    if (!originAllowed(c, ctx)) {
      return c.json({ error: { code: "forbidden", message: "origin not allowed" } }, 403);
    }
    if (c.req.method !== "POST") {
      return c.body(null, 405, { allow: "POST" });
    }
    const who = caller(c, ctx);
    if (!who) {
      if (!(await rateLimit(ctx.db, `mcp:${clientIp(c)}`, 30, 60_000))) {
        return c.json({ error: { code: "rate_limited", message: "too many attempts" } }, 429);
      }
      await writeAudit(ctx.db, { action: "mcp.denied", ip: clientIp(c) });
      return c.json(rpcError(null, -32001, "an admin access token or BAKORIN_MCP_TOKEN is required"), 401, {
        "www-authenticate": 'Bearer realm="bakorin-mcp"',
      });
    }
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(rpcError(null, -32700, "parse error"), 400);
    }
    const batch = Array.isArray(body);
    const messages = (batch ? body : [body]) as JsonRpcRequest[];
    const replies = [];
    for (const message of messages) {
      const reply = await handle(c, ctx, who, message ?? {});
      if (reply) {
        replies.push(reply);
      }
    }
    if (replies.length === 0) {
      return c.body(null, 202);
    }
    return c.json(batch ? replies : replies[0]);
  });
  return app;
}
