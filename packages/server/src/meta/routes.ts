import { Hono } from "hono";
import { buildOpenApi, metaPayload } from "./openapi.ts";

export function createMetaRoutes(): Hono {
  const app = new Hono();

  app.get("/_meta", (c) => {
    const actor = c.get("actor");
    const ctx = c.get("app");
    if (!actor || actor.role !== ctx.ast.auth.adminRole) {
      return c.json({ error: { code: "forbidden", message: "admin only" } }, 403);
    }
    return c.json({ data: metaPayload(ctx.ast) });
  });

  app.get("/openapi.json", (c) => {
    return c.json(buildOpenApi(c.get("app").ast));
  });

  return app;
}
