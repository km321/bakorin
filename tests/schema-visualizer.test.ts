import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { buildSchemaGraph, compileAppYaml, schemaToMermaid, topologicalLayers } from "@bakorin/core";
import { layoutToSvg } from "../packages/admin-ui/src/lib/schema-export.ts";
import { layoutSchema } from "../packages/admin-ui/src/lib/schema-layout.ts";
import { metaToMermaid } from "../packages/admin-ui/src/lib/schema-mermaid.ts";
import { boot, client, MINI_YAML, tempProject } from "./helpers.ts";

describe("schema graph", () => {
  test("layers follow relation depth and mermaid hides secrets", () => {
    const ast = compileAppYaml(MINI_YAML);
    const layers = topologicalLayers(ast.entities);
    expect(layers[0]).toEqual(["users"]);
    expect(layers[1]).toEqual(["items"]);
    const graph = buildSchemaGraph(ast);
    expect(graph.relations).toEqual([
      { from: "items", field: "ownerId", to: "users", onDelete: "restrict" },
    ]);
    const password = graph.entities
      .find((entity) => entity.name === "users")
      ?.fields.find((field) => field.name === "password");
    expect(password?.secret).toBe(true);
    expect(password?.displayType).toBe("hidden");
    const mermaid = schemaToMermaid(graph);
    expect(mermaid).toContain("erDiagram");
    expect(mermaid).toContain("hidden password");
    expect(mermaid).not.toContain("password password");
    expect(mermaid).toContain("items }o--|| users : \"ownerId restrict\"");
    expect(mermaid).toContain("ownerId FK");
    expect(graph.entities.find((entity) => entity.name === "users")?.policies.read).toEqual(["authenticated"]);
  });

  test("studio-leads tasks sit to the right of leads", async () => {
    const source = await Bun.file(join(import.meta.dir, "../examples/studio-leads/app.yaml")).text();
    const ast = compileAppYaml(source);
    const graph = buildSchemaGraph(ast);
    expect(graph.layers[0]).toContain("users");
    expect(graph.order.indexOf("users")).toBeLessThan(graph.order.indexOf("leads"));
    expect(graph.order.indexOf("leads")).toBeLessThan(graph.order.indexOf("tasks"));
    const layout = layoutSchema(
      graph.layers,
      graph.entities.map((entity) => ({ name: entity.name, fields: entity.fields })),
      graph.relations,
    );
    const users = layout.nodeMap.users;
    const leads = layout.nodeMap.leads;
    const tasks = layout.nodeMap.tasks;
    expect(users && leads && tasks).toBeTruthy();
    expect(users!.x).toBeLessThan(leads!.x);
    expect(leads!.x).toBeLessThan(tasks!.x);
    const toUsers = layout.edges.find((edge) => edge.from === "leads" && edge.to === "users");
    expect(toUsers?.onDelete).toBe("restrict");
    expect(toUsers?.d.startsWith("M ")).toBe(true);
    const reverse = layout.edges.find((edge) => edge.from === "tasks" && edge.to === "users");
    expect(reverse?.d.includes("C ")).toBe(true);
    const svg = layoutToSvg(
      layout,
      graph.entities.map((entity) => ({
        name: entity.name,
        label: entity.label,
        plural: entity.plural,
        display: entity.display,
        fields: entity.fields.map((field) => ({
          name: field.name,
          type: field.type,
          required: field.required,
          unique: field.unique,
          secret: field.secret,
          relation: field.relation,
        })),
      })),
      {
        bg: "#f4f1ec",
        raised: "#fffcf8",
        line: "#ddd4c7",
        text: "#1c1917",
        muted: "#57534e",
        accent: "#6f4b1e",
        accentSoft: "#f0e4d0",
      },
    );
    expect(svg).toContain("<svg");
    expect(svg).toContain("hidden");
    expect(svg).toContain("ownerId restrict");
    expect(svg).not.toContain("password password");
  });

  test("onDelete cascade and set_null appear in mermaid", () => {
    const ast = compileAppYaml(`${MINI_YAML}
  notes:
    fields:
      body: { type: text, required: true }
      itemId: { type: relation, to: items, onDelete: cascade }
      ownerId: { type: relation, to: users, required: true, onDelete: set_null }
`);
    const mermaid = schemaToMermaid(buildSchemaGraph(ast));
    expect(mermaid).toContain("itemId cascade");
    expect(mermaid).toContain("ownerId set_null");
  });
});

describe("schema CLI and admin meta", () => {
  test("bakorin schema prints mermaid and json", async () => {
    const dir = await tempProject();
    const mermaidProc = Bun.spawn(["bun", join(import.meta.dir, "../packages/server/src/cli.ts"), "schema", "--dir", dir], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const mermaidOut = await new Response(mermaidProc.stdout).text();
    await new Response(mermaidProc.stderr).text();
    expect(await mermaidProc.exited).toBe(0);
    expect(mermaidOut).toContain("erDiagram");
    expect(mermaidOut).toContain("users {");
    expect(mermaidOut).toContain("hidden password");

    const jsonProc = Bun.spawn(
      ["bun", join(import.meta.dir, "../packages/server/src/cli.ts"), "schema", "--format", "json", "--dir", dir],
      { stdout: "pipe", stderr: "pipe" },
    );
    const jsonOut = await new Response(jsonProc.stdout).text();
    await new Response(jsonProc.stderr).text();
    expect(await jsonProc.exited).toBe(0);
    const parsed = JSON.parse(jsonOut) as { layers: string[][]; entities: Array<{ name: string }> };
    expect(parsed.layers[0]).toContain("users");
    expect(parsed.entities.some((entity) => entity.name === "users")).toBe(true);

    const bad = Bun.spawn(
      ["bun", join(import.meta.dir, "../packages/server/src/cli.ts"), "schema", "--format", "xml", "--dir", dir],
      { stdout: "pipe", stderr: "pipe" },
    );
    await new Response(bad.stdout).text();
    const badErr = await new Response(bad.stderr).text();
    expect(await bad.exited).toBe(1);
    expect(badErr).toContain("mermaid|json");

    const help = Bun.spawn(["bun", join(import.meta.dir, "../packages/server/src/cli.ts"), "--help"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const helpOut = await new Response(help.stdout).text();
    await new Response(help.stderr).text();
    expect(await help.exited).toBe(0);
    expect(helpOut).toContain("schema [--format mermaid|json]");
  });

  test("admin meta includes layers, indexes, policies, and webhooks without secrets", async () => {
    const runtime = await boot(`${MINI_YAML}
webhooks:
  - entity: items
    events: [create]
    url: https://example.com/hook
    secret: webhook-secret-webhook-secret
`);
    const http = client(runtime);
    const firstAdmin = await http.fetch("/api/v1/auth/first-admin", {
      method: "POST",
      body: JSON.stringify({ email: "ada@studio.test", password: "password123", name: "Ada" }),
    });
    expect(firstAdmin.status).toBe(201);
    const token = ((await firstAdmin.json()) as { data: { accessToken: string } }).data.accessToken;
    const meta = await http.fetch("/api/v1/_meta", { headers: { authorization: `Bearer ${token}` } });
    expect(meta.status).toBe(200);
    const raw = await meta.text();
    expect(raw).not.toContain("webhook-secret-webhook-secret");
    const payload = JSON.parse(raw) as {
      data: {
        layers: string[][];
        webhooks: Array<{ entity: string; events: string[]; secret?: string }>;
        entities: Array<{
          name: string;
          indexes: string[][];
          policies: Record<string, string[]>;
          fields: Array<{
            name: string;
            unique?: boolean;
            secret: boolean;
            type: string;
            required: boolean;
            relation?: { to: string; onDelete?: string };
          }>;
        }>;
        app: { name: string; version: string };
        auth: {
          entity: string;
          identityField: string;
          passwordField: string;
          adminRole: string;
          roleField: string;
          requireVerifiedEmail: boolean;
        };
      };
    };
    expect(payload.data.layers[0]).toEqual(["users"]);
    expect(payload.data.webhooks[0]?.entity).toBe("items");
    expect(payload.data.webhooks[0]?.secret).toBeUndefined();
    const users = payload.data.entities.find((entity) => entity.name === "users");
    expect(users?.fields.some((field) => field.name === "password" && field.secret)).toBe(true);
    expect(users?.policies.read).toEqual(["authenticated"]);
    expect(Array.isArray(users?.indexes)).toBe(true);
    const items = payload.data.entities.find((entity) => entity.name === "items");
    expect(items?.fields.find((field) => field.name === "ownerId")?.relation?.onDelete).toBe("restrict");
    const mermaid = metaToMermaid(payload.data as unknown as Parameters<typeof metaToMermaid>[0]);
    expect(mermaid).toContain("erDiagram");
    expect(mermaid).toContain("hidden password");
    expect(mermaid).toContain("ownerId restrict");
    await runtime.close();
  });
});
