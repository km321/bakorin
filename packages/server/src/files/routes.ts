import { Hono } from "hono";
import { FILES_TABLE } from "../db/system.ts";

export function createFileRoutes(): Hono {
  const app = new Hono();

  app.post("/", async (c) => {
    const actor = c.get("actor");
    if (!actor) {
      return c.json({ error: { code: "unauthenticated", message: "sign in to upload files" } }, 401);
    }
    const ctx = c.get("app");
    const body = await c.req.parseBody();
    const file = body.file;
    if (!(file instanceof File)) {
      return c.json({ error: { code: "invalid_input", message: "file field is required" } }, 400);
    }
    const id = crypto.randomUUID();
    const ext = file.name.includes(".") ? file.name.slice(file.name.lastIndexOf(".")) : "";
    const key = `${id}${ext}`;
    const bytes = new Uint8Array(await file.arrayBuffer());
    await ctx.files.put(key, bytes, file.type || "application/octet-stream");
    const now = new Date().toISOString();
    await ctx.db
      .insertInto(FILES_TABLE)
      .values({
        id,
        key,
        filename: file.name,
        content_type: file.type || "application/octet-stream",
        size: bytes.byteLength,
        created_by: actor.id,
        created_at: now,
      })
      .execute();
    return c.json({ data: { id, key, filename: file.name, contentType: file.type, size: bytes.byteLength, url: `/api/v1/files/${id}` } }, 201);
  });

  app.get("/:id", async (c) => {
    const ctx = c.get("app");
    const row = await ctx.db.selectFrom(FILES_TABLE).selectAll().where("id", "=", c.req.param("id")).executeTakeFirst();
    if (!row) {
      return c.json({ error: { code: "not_found", message: "file not found" } }, 404);
    }
    const actor = c.get("actor");
    const admin = actor?.role === ctx.ast.auth.adminRole;
    if (!admin && row.created_by && actor?.id !== row.created_by) {
      return c.json({ error: { code: "forbidden", message: "not allowed" } }, 403);
    }
    const stored = await ctx.files.get(String(row.key));
    if (!stored) {
      return c.json({ error: { code: "not_found", message: "file missing from store" } }, 404);
    }
    return new Response(stored.bytes, {
      headers: {
        "content-type": String(row.content_type),
        "content-disposition": `inline; filename="${String(row.filename).replaceAll('"', "")}"`,
      },
    });
  });

  return app;
}
