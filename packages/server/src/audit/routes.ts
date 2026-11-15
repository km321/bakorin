import { Hono } from "hono";
import { requireAdmin } from "../auth/guard.ts";
import { listAudit } from "./log.ts";

export function createAuditRoutes(): Hono {
  const app = new Hono();

  app.get("/", async (c) => {
    const denied = requireAdmin(c);
    if (denied) {
      return denied;
    }
    const url = new URL(c.req.url);
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") ?? 50) || 50));
    const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0) || 0);
    const result = await listAudit(c.get("app").db, { limit, offset });
    return c.json({ data: result.rows, meta: { total: result.total, limit, offset } });
  });

  return app;
}
