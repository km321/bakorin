import { Hono } from "hono";
import { requireAdmin } from "../auth/guard.ts";
import { buildOpenApi, metaPayload } from "./openapi.ts";

export function createMetaRoutes(): Hono {
  const app = new Hono();

  app.get("/_meta", (c) => {
    const denied = requireAdmin(c);
    if (denied) {
      return denied;
    }
    return c.json({ data: metaPayload(c.get("app").ast) });
  });

  app.get("/openapi.json", (c) => {
    return c.json(buildOpenApi(c.get("app").ast));
  });

  return app;
}
