import { Hono } from "hono";
import { FILES_TABLE } from "../db/system.ts";
import { signFileUrl, verifyFileSignature } from "./sign.ts";

function mimeFromName(name: string): string | null {
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
  switch (ext) {
    case "txt":
      return "text/plain";
    case "pdf":
      return "application/pdf";
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
    default:
      return null;
  }
}

function allowMime(allowed: string[], type: string): boolean {
  if (allowed.includes("*")) {
    return true;
  }
  const base = type.split(";")[0]?.trim().toLowerCase() ?? type;
  return allowed.some((item) => item.toLowerCase() === base);
}

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
    const inferred = mimeFromName(file.name);
    const rawType =
      file.type && file.type !== "application/octet-stream" ? file.type : inferred ?? (file.type || "application/octet-stream");
    const type = rawType.split(";")[0]?.trim() || rawType;
    if (!allowMime(ctx.ast.runtime.files.allowedMimeTypes, type)) {
      return c.json({ error: { code: "invalid_input", message: `file type ${type} is not allowed` } }, 400);
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.byteLength > ctx.ast.runtime.files.maxBytes) {
      return c.json(
        { error: { code: "invalid_input", message: `file exceeds max size of ${ctx.ast.runtime.files.maxBytes} bytes` } },
        400,
      );
    }
    const id = crypto.randomUUID();
    const ext = file.name.includes(".") ? file.name.slice(file.name.lastIndexOf(".")) : "";
    const key = `${id}${ext}`;
    await ctx.files.put(key, bytes, type);
    const now = new Date().toISOString();
    await ctx.db
      .insertInto(FILES_TABLE)
      .values({
        id,
        key,
        filename: file.name,
        content_type: type,
        size: bytes.byteLength,
        created_by: actor.id,
        created_at: now,
      })
      .execute();
    const exp = Math.floor(Date.now() / 1000) + ctx.ast.runtime.files.signedUrlTtlSeconds;
    const url = signFileUrl(ctx.ast.runtime.jwtSecret, id, exp);
    return c.json({ data: { id, key, filename: file.name, contentType: type, size: bytes.byteLength, url, expiresAt: exp } }, 201);
  });

  app.post("/:id/sign", async (c) => {
    const actor = c.get("actor");
    if (!actor) {
      return c.json({ error: { code: "unauthenticated", message: "sign in required" } }, 401);
    }
    const ctx = c.get("app");
    const row = await ctx.db.selectFrom(FILES_TABLE).selectAll().where("id", "=", c.req.param("id")).executeTakeFirst();
    if (!row) {
      return c.json({ error: { code: "not_found", message: "file not found" } }, 404);
    }
    const admin = actor.role === ctx.ast.auth.adminRole;
    if (!admin && row.created_by && actor.id !== row.created_by) {
      return c.json({ error: { code: "forbidden", message: "not allowed" } }, 403);
    }
    const exp = Math.floor(Date.now() / 1000) + ctx.ast.runtime.files.signedUrlTtlSeconds;
    const url = signFileUrl(ctx.ast.runtime.jwtSecret, String(row.id), exp);
    return c.json({ data: { url, expiresAt: exp } });
  });

  app.get("/:id", async (c) => {
    const ctx = c.get("app");
    const id = c.req.param("id");
    const url = new URL(c.req.url);
    const valid = verifyFileSignature(
      ctx.ast.runtime.jwtSecret,
      id,
      url.searchParams.get("exp") ?? undefined,
      url.searchParams.get("sig") ?? undefined,
      ctx.ast.runtime.jwtSecretPrevious,
    );
    if (!valid) {
      return c.json({ error: { code: "unauthenticated", message: "signed URL required" } }, 401);
    }
    const row = await ctx.db.selectFrom(FILES_TABLE).selectAll().where("id", "=", id).executeTakeFirst();
    if (!row) {
      return c.json({ error: { code: "not_found", message: "file not found" } }, 404);
    }
    const stored = await ctx.files.get(String(row.key));
    if (!stored) {
      return c.json({ error: { code: "not_found", message: "file missing from store" } }, 404);
    }
    return new Response(stored.bytes as BodyInit, {
      headers: {
        "content-type": String(row.content_type),
        "content-disposition": `inline; filename="${String(row.filename).replaceAll('"', "")}"`,
        "cache-control": "private, max-age=60",
      },
    });
  });

  return app;
}
