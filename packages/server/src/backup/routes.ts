import { Hono } from "hono";
import { requireAdmin } from "../auth/guard.ts";
import { listBackups } from "./list.ts";
import { runBackup } from "./schedule.ts";
import {
  actorIsAdmin,
  backupEntries,
  createDownloadToken,
  DOWNLOAD_TTL_MS,
  downloadFilename,
  isBackupId,
  readDownloadToken,
} from "./download.ts";
import { gzipStream, tarStream } from "./tar.ts";

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
      reason: "manual",
    });
    const listed = await listBackups(ctx.ast, ctx.projectDir);
    const id = location.replace(/\/+$/, "").split("/").pop();
    const created = listed.find((item) => item.location === location || item.id === id) ?? listed[0] ?? null;
    return c.json({ data: created ?? { location, restoreCommand: `bakorin restore ${location}` } }, 201);
  });

  /** Short-lived link the admin UI navigates to, so the browser handles the download. */
  app.post("/:id/link", async (c) => {
    const denied = requireAdmin(c);
    if (denied) {
      return denied;
    }
    const ctx = c.get("app");
    const id = c.req.param("id");
    if (!isBackupId(id) || !(await backupEntries(ctx.ast, ctx.projectDir, id))) {
      return c.json({ error: { code: "not_found", message: "backup not found" } }, 404);
    }
    const token = createDownloadToken(ctx.ast.runtime.jwtSecret, id, c.get("actor")?.id ?? "");
    return c.json({
      data: {
        url: `/api/v1/backups/${encodeURIComponent(id)}/download?token=${encodeURIComponent(token)}`,
        expiresAt: new Date(Date.now() + DOWNLOAD_TTL_MS).toISOString(),
      },
    });
  });

  /**
   * Streams one backup as .tar.gz. Accepts an admin bearer token (for curl) or a
   * signed link from POST /:id/link; the link's admin is checked again here.
   */
  app.get("/:id/download", async (c) => {
    const ctx = c.get("app");
    const id = c.req.param("id");
    const actor = c.get("actor");
    let allowed = Boolean(actor && actor.role === ctx.ast.auth.adminRole);
    if (!allowed) {
      const token = c.req.query("token");
      const claims = token
        ? readDownloadToken([ctx.ast.runtime.jwtSecret, ctx.ast.runtime.jwtSecretPrevious], token, id)
        : null;
      allowed = Boolean(claims && (await actorIsAdmin(ctx, claims.sub)));
      if (!allowed) {
        return c.json(
          { error: { code: "forbidden", message: "download link expired or not allowed; start the download again" } },
          403,
        );
      }
    }
    const entries = await backupEntries(ctx.ast, ctx.projectDir, id);
    if (!entries) {
      return c.json({ error: { code: "not_found", message: "backup not found" } }, 404);
    }
    return new Response(gzipStream(tarStream(entries)), {
      headers: {
        "content-type": "application/gzip",
        "content-disposition": `attachment; filename="${downloadFilename(ctx.ast.appName, id)}"`,
        "cache-control": "no-store",
      },
    });
  });

  return app;
}
