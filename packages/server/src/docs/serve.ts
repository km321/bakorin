import { Hono } from "hono";
import swaggerUiCss from "swagger-ui-dist/swagger-ui.css" with { type: "text" };
import swaggerUiBundle from "swagger-ui-dist/swagger-ui-bundle.js" with { type: "text" };
import pageHtmlSource from "./page.html" with { type: "text" };
import pageCss from "./page.css" with { type: "text" };
import initJs from "./init.js" with { type: "text" };
import themeJs from "./theme.js" with { type: "text" };

// Bun types .html imports as an HTML bundle; with type "text" it is the file contents.
const pageHtml = pageHtmlSource as unknown as string;
import type { SchemaAST } from "@bakorin/core";
import { brandName } from "@bakorin/core";
import { injectBranding, publicBranding } from "../branding/assets.ts";

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

/** The docs page, branded when app.yaml has a branding section. Unchanged otherwise. */
export function docsHtml(ast?: SchemaAST): string {
  if (!ast?.branding) {
    return pageHtml;
  }
  const name = escapeHtml(brandName(ast.appName, ast.branding));
  const brand = publicBranding(ast);
  const logo = brand?.logo ? `<img class="docs-brand-logo" src="${escapeHtml(brand.logo)}" alt="" />` : "";
  return injectBranding(pageHtml, ast, (value) => `${value} API docs`)
    .replace(
      '<header class="docs-banner">',
      `<header class="docs-banner docs-banner-branded">\n      <p class="docs-brand">${logo}<strong>${name}</strong> <span>API docs</span></p>`,
    )
    .replace("Bakorin API docs from", "Generated from");
}

export function docsIndex(ast?: SchemaAST): Response {
  return new Response(docsHtml(ast), {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

export function createDocsRoutes(): Hono {
  const app = new Hono();

  app.get("/", (c) => docsIndex(c.get("app")?.ast));
  app.get("/index.html", (c) => docsIndex(c.get("app")?.ast));

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

  app.get("/page.css", () => {
    return new Response(pageCss, {
      headers: { "content-type": "text/css; charset=utf-8", "cache-control": "public, max-age=3600" },
    });
  });

  app.get("/init.js", () => {
    return new Response(initJs, {
      headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "public, max-age=3600" },
    });
  });

  app.get("/theme.js", () => {
    return new Response(themeJs, {
      headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "public, max-age=3600" },
    });
  });

  return app;
}
