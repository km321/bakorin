import { resolve } from "node:path";
import { Hono } from "hono";
import { embeddedUi } from "../embedded-ui.ts";

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
    const disk = await fromDisk(rel);
    if (disk) {
      return new Response(disk, { headers: { "content-type": contentType(rel) } });
    }
    if (isDocument) {
      const index = await fromDisk("index.html");
      if (index) {
        return new Response(index, { headers: { "content-type": "text/html" } });
      }
    }
    const embedded = embeddedUi[rel] ?? (isDocument ? embeddedUi["index.html"] : undefined);
    if (embedded) {
      const bytes =
        embedded.encoding === "base64" ? Buffer.from(embedded.content, "base64") : Buffer.from(embedded.content, "utf8");
      return new Response(bytes, { headers: { "content-type": contentType(rel) } });
    }
    return c.text("Admin UI is not built. Run bun run build:ui.", 503);
  });
  return app;
}
