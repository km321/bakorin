import { describe, expect, test } from "bun:test";
import OpenAPISchemaValidator from "openapi-schema-validator";
import { boot, client } from "./helpers.ts";

const Validator = (OpenAPISchemaValidator as unknown as { default?: typeof OpenAPISchemaValidator }).default ?? OpenAPISchemaValidator;

describe("api docs", () => {
  test("GET /docs and /api/v1/docs return the bundled Swagger UI", async () => {
    const runtime = await boot();
    const docs = await client(runtime).fetch("/docs");
    expect(docs.status).toBe(200);
    expect(docs.headers.get("content-type") ?? "").toContain("text/html");
    const html = await docs.text();
    expect(html).toContain("swagger-ui");
    expect(html).toContain("/api/v1/openapi.json");
    expect(html).toContain("/docs/init.js");
    const init = await client(runtime).fetch("/docs/init.js");
    expect(init.status).toBe(200);
    expect(await init.text()).toContain("bakorin_access");

    const alias = await client(runtime).fetch("/api/v1/docs");
    expect(alias.status).toBe(200);
    expect(await alias.text()).toContain("swagger-ui-bundle.js");

    const bundle = await client(runtime).fetch("/docs/swagger-ui-bundle.js");
    expect(bundle.status).toBe(200);
    expect(bundle.headers.get("content-type") ?? "").toContain("javascript");
    const css = await client(runtime).fetch("/docs/swagger-ui.css");
    expect(css.status).toBe(200);
    await runtime.close();
  });

  test("OpenAPI spec is complete and validates", async () => {
    const runtime = await boot();
    const response = await client(runtime).fetch("/api/v1/openapi.json");
    expect(response.status).toBe(200);
    const spec = (await response.json()) as {
      openapi: string;
      paths: Record<string, { get?: { parameters?: Array<{ name: string }> }; post?: unknown }>;
      components: { schemas: Record<string, unknown> };
    };
    const result = new Validator({ version: 3 }).validate(spec as never);
    expect(result.errors ?? []).toEqual([]);
    expect(spec.openapi).toBe("3.0.3");
    expect(spec.paths["/api/v1/auth/setup"]?.get).toBeTruthy();
    expect(spec.paths["/api/v1/auth/first-admin"]?.post).toBeTruthy();
    expect(spec.paths["/api/v1/auth/login"]?.post).toBeTruthy();
    expect(spec.paths["/api/v1/auth/refresh"]?.post).toBeTruthy();
    expect(spec.paths["/api/v1/auth/logout"]?.post).toBeTruthy();
    expect(spec.paths["/api/v1/auth/me"]?.get).toBeTruthy();
    expect(spec.paths["/api/v1/auth/forgot-password"]?.post).toBeTruthy();
    expect(spec.paths["/api/v1/auth/reset-password"]?.post).toBeTruthy();
    expect(spec.paths["/api/v1/auth/verify-email"]?.post).toBeTruthy();
    expect(spec.paths["/api/v1/auth/invites"]?.post).toBeTruthy();
    expect(spec.paths["/api/v1/auth/accept-invite"]?.post).toBeTruthy();
    expect(spec.paths["/api/v1/files"]?.post).toBeTruthy();
    expect(spec.paths["/api/v1/files/{id}"]?.get).toBeTruthy();
    expect(spec.paths["/api/v1/items"]?.get).toBeTruthy();
    expect(spec.paths["/api/v1/items/{id}"]?.get).toBeTruthy();
    expect(spec.paths["/api/v1/backups"]?.post).toBeTruthy();
    expect(spec.paths["/docs"]?.get).toBeTruthy();
    const listParams = spec.paths["/api/v1/items"]?.get?.parameters?.map((item) => item.name) ?? [];
    expect(listParams).toContain("limit");
    expect(listParams).toContain("offset");
    expect(listParams).toContain("sort");
    expect(listParams).toContain("filter[title]");
    expect(spec.components.schemas.Items).toBeTruthy();
    expect(spec.components.schemas.ItemsWrite).toBeTruthy();
    await runtime.close();
  });
});

function themeTokens(css: string, selector: string): Record<string, string> {
  const start = css.indexOf(selector);
  expect(start).toBeGreaterThanOrEqual(0);
  const body = css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start));
  const tokens: Record<string, string> = {};
  for (const match of body.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})/g)) {
    tokens[match[1]!] = match[2]!.toLowerCase();
  }
  return tokens;
}

function luminance(hex: string): number {
  const channel = (offset: number) => {
    const v = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

describe("api docs theme", () => {
  test("docs page follows the admin theme key and ships a toggle", async () => {
    const runtime = await boot();
    const html = await (await client(runtime).fetch("/docs")).text();
    expect(html).toContain("/docs/theme.js");
    // theme.js loads before the stylesheets so there is no light/dark flash
    expect(html.indexOf("/docs/theme.js")).toBeLessThan(html.indexOf("/docs/swagger-ui.css"));
    expect(html).toContain('data-mode="dark"');
    const theme = await client(runtime).fetch("/docs/theme.js");
    expect(theme.status).toBe(200);
    expect(theme.headers.get("content-type") ?? "").toContain("javascript");
    const js = await theme.text();
    expect(js).toContain("bakorin_theme");
    expect(js).toContain("prefers-color-scheme: dark");
    expect(js).toContain("dark-mode");
    const css = await (await client(runtime).fetch("/docs/page.css")).text();
    expect(css).toContain(':root[data-theme="dark"]');
    // The old page forced a dark background in both themes.
    expect(css).not.toMatch(/html,\s*body\s*{[^}]*#101214/);
    await runtime.close();
  });

  test("dark and light docs tokens meet WCAG 2.2 AA contrast", async () => {
    const css = await Bun.file(new URL("../packages/server/src/docs/page.css", import.meta.url)).text();
    const dark = themeTokens(css, ':root[data-theme="dark"] {');
    const light = themeTokens(css, ':root[data-theme="light"] {');

    const darkText: Array<[string, string]> = [
      ["docs-text", "docs-bg"],
      ["docs-text", "docs-bg-raised"],
      ["docs-text", "docs-bg-input"],
      ["docs-muted", "docs-bg"],
      ["docs-muted", "docs-bg-raised"],
      ["docs-accent", "docs-bg"],
      ["docs-accent", "docs-bg-raised"],
      ["docs-accent-fg", "docs-accent"],
      ["docs-ok", "docs-bg-raised"],
      ["docs-danger", "docs-bg-raised"],
      ["docs-code-text", "docs-bg-code"],
      ["docs-code-key", "docs-bg-code"],
      ["docs-code-number", "docs-bg-code"],
      ["docs-code-literal", "docs-bg-code"],
    ];
    for (const method of ["get", "post", "put", "patch", "delete", "head", "options"]) {
      darkText.push([`docs-method-fg`, `docs-${method}`]);
      darkText.push([`docs-text`, `docs-${method}-soft`]);
      darkText.push([`docs-muted`, `docs-${method}-soft`]);
    }
    for (const [fg, bg] of darkText) {
      expect({ pair: `${fg} on ${bg}`, ok: contrast(dark[fg]!, dark[bg]!) >= 4.5 }).toEqual({ pair: `${fg} on ${bg}`, ok: true });
    }
    // Non-text UI: input borders and method borders against the page.
    expect(contrast(dark["docs-line-strong"]!, dark["docs-bg-input"]!)).toBeGreaterThanOrEqual(3);
    for (const method of ["get", "post", "put", "patch", "delete", "head", "options"]) {
      expect(contrast(dark[`docs-${method}`]!, dark["docs-bg"]!)).toBeGreaterThanOrEqual(3);
    }

    const lightText: Array<[string, string]> = [
      ["docs-text", "docs-bg"],
      ["docs-muted", "docs-bg"],
      ["docs-accent", "docs-bg"],
      ["docs-ok", "docs-bg-raised"],
      ["docs-danger", "docs-bg-raised"],
      ["docs-code-text", "docs-bg-code"],
      ["docs-code-number", "docs-bg-code"],
    ];
    for (const [fg, bg] of lightText) {
      expect({ pair: `${fg} on ${bg}`, ok: contrast(light[fg]!, light[bg]!) >= 4.5 }).toEqual({ pair: `${fg} on ${bg}`, ok: true });
    }
    for (const method of ["get", "post", "put", "patch", "delete", "head", "options"]) {
      // White badge text on the light method colors.
      expect(contrast("#ffffff", light[`docs-${method}`]!)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
