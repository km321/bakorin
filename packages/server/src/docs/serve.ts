import { Hono } from "hono";
import swaggerUiCss from "swagger-ui-dist/swagger-ui.css" with { type: "text" };
import swaggerUiBundle from "swagger-ui-dist/swagger-ui-bundle.js" with { type: "text" };
import pageHtml from "./page.html" with { type: "text" };

export function docsIndex(): Response {
  return new Response(pageHtml, {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

export function createDocsRoutes(): Hono {
  const app = new Hono();

  app.get("/", () => docsIndex());
  app.get("/index.html", () => docsIndex());

  app.get("/swagger-ui.css", () => {
    return new Response(swaggerUiCss, {
      headers: { "content-type": "text/css; charset=utf-8", "cache-control": "public, max-age=3600" },
    });
  });

  app.get("/swagger-ui-bundle.js", () => {
    return new Response(swaggerUiBundle, {
      headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "public, max-age=3600" },
    });
  });

  return app;
}
