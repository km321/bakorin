import { resolve } from "node:path";
import { Hono } from "hono";
import type { SchemaAST } from "@bakorin/core";
import { embeddedUi } from "../embedded-ui.ts";
import { injectBranding } from "../branding/assets.ts";

function brandDocument(bytes: Uint8Array, ast: SchemaAST | undefined): Uint8Array | string {
  if (!ast?.branding) {
    return bytes;
  }
  return injectBranding(Buffer.from(bytes).toString("utf8"), ast, (name) => `${name} Admin`);
}

function contentType(path: string): string {
  if (path.endsWith(".js")) {
    return "text/javascript";
  }
  if (path.endsWith(".css")) {
    return "text/css";
  }
  if (path.endsWith(".svg")) {
    return "image/svg+xml";
  }
  if (path.endsWith(".woff2")) {
    return "font/woff2";
  }
  if (path.endsWith(".png")) {
    return "image/png";
  }
  return "text/html";
}

async function fromDisk(rel: string): Promise<Uint8Array | null> {
  const candidates = [
    resolve(import.meta.dir, "../../../admin-ui/dist", rel),
    resolve(process.cwd(), "packages/admin-ui/dist", rel),
    resolve(process.cwd(), "../../packages/admin-ui/dist", rel),
  ];
  for (const path of candidates) {
    const file = Bun.file(path);
    if (await file.exists()) {
      return new Uint8Array(await file.arrayBuffer());
    }
  }
  return null;
}

export function createAdminRoutes(): Hono {
  const app = new Hono();
  app.get("/*", async (c) => {
    const url = new URL(c.req.url);
    let rel = url.pathname.replace(/^\/admin\/?/, "");
    if (!rel || rel.endsWith("/")) {
      rel = `${rel}index.html`.replace(/^\//, "");
    }
    const isDocument = !rel.includes(".") || rel.endsWith(".html");
    const ast = c.get("app")?.ast as SchemaAST | undefined;
    const disk = await fromDisk(rel);
    if (disk) {
      const body = rel.endsWith(".html") ? brandDocument(disk, ast) : disk;
      return new Response(body, { headers: { "content-type": contentType(rel) } });
    }
    if (isDocument) {
      const index = await fromDisk("index.html");
      if (index) {
        return new Response(brandDocument(index, ast), { headers: { "content-type": "text/html" } });
      }
    }
    const embedded = embeddedUi[rel] ?? (isDocument ? embeddedUi["index.html"] : undefined);
    if (embedded) {
      const bytes =
        embedded.encoding === "base64" ? Buffer.from(embedded.content, "base64") : Buffer.from(embedded.content, "utf8");
      const body = contentType(rel) === "text/html" ? brandDocument(new Uint8Array(bytes), ast) : bytes;
      return new Response(body, { headers: { "content-type": contentType(rel) } });
    }
    return c.text("Admin UI is not built. Run bun run build:ui.", 503);
  });
  return app;
}
