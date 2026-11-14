import { Hono } from "hono";
import { requireAdmin } from "../auth/guard.ts";
import { listBackups } from "./list.ts";
import { runBackup } from "./schedule.ts";

export function createBackupRoutes(): Hono {
  const app = new Hono();

  app.get("/", async (c) => {
    const denied = requireAdmin(c);
    if (denied) {
      return denied;
    }
    const ctx = c.get("app");
    const data = await listBackups(ctx.ast, ctx.projectDir);
    return c.json({ data });
  });

  app.post("/", async (c) => {
    const denied = requireAdmin(c);
    if (denied) {
      return denied;
    }
    const ctx = c.get("app");
    const location = await runBackup({
      ast: ctx.ast,
      db: ctx.db,
      files: ctx.files,
      projectDir: ctx.projectDir,
    });
    const listed = await listBackups(ctx.ast, ctx.projectDir);
    const id = location.replace(/\/+$/, "").split("/").pop();
    const created = listed.find((item) => item.location === location || item.id === id) ?? listed[0] ?? null;
    return c.json({ data: created ?? { location, restoreCommand: `bakorin restore ${location}` } }, 201);
  });

  return app;
}
