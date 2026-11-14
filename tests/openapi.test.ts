import { describe, expect, test } from "bun:test";
import { boot, client } from "./helpers.ts";

describe("openapi", () => {
  test("serves a generated OpenAPI 3 document", async () => {
    const runtime = await boot();
    const response = await client(runtime).fetch("/api/v1/openapi.json");
    expect(response.status).toBe(200);
    const spec = (await response.json()) as {
      openapi: string;
      info: { title: string };
      paths: Record<string, { post?: { requestBody?: unknown }; get?: unknown }>;
      components: { securitySchemes: { bearerAuth?: unknown }; schemas: Record<string, unknown> };
    };
    expect(spec.openapi).toBe("3.0.3");
    expect(spec.info.title).toBe("mini");
    expect(spec.paths["/api/v1/items"]?.post?.requestBody).toBeTruthy();
    expect(spec.paths["/api/v1/items/{id}"]).toBeTruthy();
    expect(spec.paths["/api/v1/auth/login"]).toBeTruthy();
    expect(spec.paths["/api/v1/files"]).toBeTruthy();
    expect(spec.components.securitySchemes.bearerAuth).toBeTruthy();
    expect(spec.components.schemas.Items).toBeTruthy();
    expect(spec.components.schemas.ItemsWrite).toBeTruthy();
    expect(spec.components.schemas.Error).toBeTruthy();
    await runtime.close();
  });
});
