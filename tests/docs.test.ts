import { describe, expect, test } from "bun:test";
import OpenAPISchemaValidator from "openapi-schema-validator";
import { boot, client } from "./helpers.ts";

const Validator = (OpenAPISchemaValidator as unknown as { default?: typeof OpenAPISchemaValidator }).default ?? OpenAPISchemaValidator;

describe("api docs", () => {
  test("GET /docs and /api/v1/docs return the bundled Swagger UI", async () => {
    const runtime = await boot();
    const docs = await client(runtime).fetch("/docs");
    expect(docs.status).toBe(200);
    expect(docs.headers.get("content-type") ?? "").toContain("text/html");
    const html = await docs.text();
    expect(html).toContain("swagger-ui");
    expect(html).toContain("/api/v1/openapi.json");
    expect(html).toContain("/docs/init.js");
    const init = await client(runtime).fetch("/docs/init.js");
    expect(init.status).toBe(200);
    expect(await init.text()).toContain("bakorin_access");

    const alias = await client(runtime).fetch("/api/v1/docs");
    expect(alias.status).toBe(200);
    expect(await alias.text()).toContain("swagger-ui-bundle.js");

    const bundle = await client(runtime).fetch("/docs/swagger-ui-bundle.js");
    expect(bundle.status).toBe(200);
    expect(bundle.headers.get("content-type") ?? "").toContain("javascript");
    const css = await client(runtime).fetch("/docs/swagger-ui.css");
    expect(css.status).toBe(200);
    await runtime.close();
  });

  test("OpenAPI spec is complete and validates", async () => {
    const runtime = await boot();
    const response = await client(runtime).fetch("/api/v1/openapi.json");
    expect(response.status).toBe(200);
    const spec = (await response.json()) as {
      openapi: string;
      paths: Record<string, { get?: { parameters?: Array<{ name: string }> }; post?: unknown }>;
      components: { schemas: Record<string, unknown> };
    };
    const result = new Validator({ version: 3 }).validate(spec as never);
    expect(result.errors ?? []).toEqual([]);
    expect(spec.openapi).toBe("3.0.3");
    expect(spec.paths["/api/v1/auth/login"]?.post).toBeTruthy();
    expect(spec.paths["/api/v1/auth/refresh"]?.post).toBeTruthy();
    expect(spec.paths["/api/v1/auth/logout"]?.post).toBeTruthy();
    expect(spec.paths["/api/v1/auth/me"]?.get).toBeTruthy();
    expect(spec.paths["/api/v1/auth/forgot-password"]?.post).toBeTruthy();
    expect(spec.paths["/api/v1/auth/reset-password"]?.post).toBeTruthy();
    expect(spec.paths["/api/v1/auth/verify-email"]?.post).toBeTruthy();
    expect(spec.paths["/api/v1/auth/invites"]?.post).toBeTruthy();
    expect(spec.paths["/api/v1/auth/accept-invite"]?.post).toBeTruthy();
    expect(spec.paths["/api/v1/files"]?.post).toBeTruthy();
    expect(spec.paths["/api/v1/files/{id}"]?.get).toBeTruthy();
    expect(spec.paths["/api/v1/items"]?.get).toBeTruthy();
    expect(spec.paths["/api/v1/items/{id}"]?.get).toBeTruthy();
    expect(spec.paths["/api/v1/backups"]?.post).toBeTruthy();
    expect(spec.paths["/docs"]?.get).toBeTruthy();
    const listParams = spec.paths["/api/v1/items"]?.get?.parameters?.map((item) => item.name) ?? [];
    expect(listParams).toContain("limit");
    expect(listParams).toContain("offset");
    expect(listParams).toContain("sort");
    expect(listParams).toContain("filter[title]");
    expect(spec.components.schemas.Items).toBeTruthy();
    expect(spec.components.schemas.ItemsWrite).toBeTruthy();
    await runtime.close();
  });
});
