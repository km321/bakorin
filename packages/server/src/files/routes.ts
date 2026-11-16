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

/** Types a browser can show inline without running script from our origin. */
const INLINE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "application/pdf", "text/plain"]);

/**
 * Download headers. Only images, PDF and plain text render inline. Anything
 * else (HTML, SVG, JS, unknown types) downloads as an attachment and is
 * sandboxed, so an uploaded page cannot run script on the API or admin origin.
 */
export function fileResponseHeaders(contentType: string, filename: string): Record<string, string> {
  const base = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  const inline = INLINE_TYPES.has(base);
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "");
  const headers: Record<string, string> = {
    "content-type": contentType,
    "content-disposition": `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    "x-content-type-options": "nosniff",
    "cache-control": "private, max-age=60",
  };
  if (!inline) {
    headers["content-security-policy"] = "default-src 'none'; sandbox";
  }
  return headers;
}

function startsWith(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  return signature.every((value, index) => bytes[offset + index] === value);
}

/** For types we render inline, check the magic bytes match the declared type. */
export function contentMatchesType(bytes: Uint8Array, type: string): boolean {
  switch (type.toLowerCase()) {
    case "image/png":
      return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case "image/jpeg":
      return startsWith(bytes, [0xff, 0xd8, 0xff]);
    case "image/gif":
      return startsWith(bytes, [0x47, 0x49, 0x46, 0x38]);
    case "image/webp":
      return startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8);
    case "application/pdf":
      return startsWith(bytes, [0x25, 0x50, 0x44, 0x46]);
    default:
      return true;
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
    if (!contentMatchesType(bytes, type)) {
      return c.json({ error: { code: "invalid_input", message: `file contents do not look like ${type}` } }, 400);
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
    return new Response(stored.bytes as BodyInit, { headers: fileResponseHeaders(String(row.content_type), String(row.filename)) });
  });

  return app;
}
