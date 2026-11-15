import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, extname, relative, resolve, sep } from "node:path";
import { Hono } from "hono";
import {
  BRANDING_DIR,
  BRANDING_MAX_FILE_BYTES,
  brandingCss,
  brandName,
  SchemaError,
  type BrandingAST,
  type SchemaAST,
} from "@bakorin/core";

const TYPES: Record<string, string> = {
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
};

/** Absolute path for a branding file, or null if it would leave the branding/ folder. */
export function brandingFilePath(projectDir: string, file: string): string | null {
  const root = resolve(projectDir, BRANDING_DIR);
  const full = resolve(projectDir, file);
  const rel = relative(root, full);
  if (!rel || rel.startsWith("..") || rel.includes(sep) || rel.startsWith(sep)) {
    return null;
  }
  return full;
}

/** Boot check: every referenced branding file exists, stays in branding/, and is small. */
export function validateBrandingFiles(projectDir: string, branding: BrandingAST | undefined): void {
  if (!branding) {
    return;
  }
  const problems: string[] = [];
  for (const [key, file] of [
    ["logo", branding.logo],
    ["favicon", branding.favicon],
  ] as const) {
    if (!file) {
      continue;
    }
    const path = brandingFilePath(projectDir, file);
    if (!path) {
      problems.push(`branding.${key} must point inside the branding/ folder`);
      continue;
    }
    if (!existsSync(path)) {
      problems.push(`branding.${key}: ${file} does not exist. Add it next to app.yaml or remove branding.${key}`);
      continue;
    }
    const size = statSync(path).size;
    if (size > BRANDING_MAX_FILE_BYTES) {
      problems.push(`branding.${key}: ${file} is ${Math.round(size / 1024)} KB; keep it under 1 MB`);
    }
  }
  if (problems.length > 0) {
    throw new SchemaError(problems.join("\n"));
  }
}

export function logBrandingWarnings(branding: BrandingAST | undefined): void {
  for (const warning of branding?.warnings ?? []) {
    console.warn(`[bakorin] ${warning}`);
  }
}

function version(branding: BrandingAST): string {
  return createHash("sha256").update(JSON.stringify(branding)).digest("hex").slice(0, 10);
}

/** Public URL path for a branding file, like /branding/logo.svg?v=1a2b3c. */
export function brandingUrl(branding: BrandingAST, file: string): string {
  return `/branding/${encodeURIComponent(basename(file))}?v=${version(branding)}`;
}

function escapeAttr(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export interface PublicBranding {
  name: string;
  logo: string | null;
}

export function publicBranding(ast: SchemaAST): PublicBranding | null {
  const branding = ast.branding;
  if (!branding) {
    return null;
  }
  return {
    name: brandName(ast.appName, branding),
    logo: branding.logo ? brandingUrl(branding, branding.logo) : null,
  };
}

/** Tags for <head>: generated colors, favicon, and a meta tag the admin reads. CSP safe (no inline code). */
export function brandingHead(ast: SchemaAST): string {
  const branding = ast.branding;
  if (!branding) {
    return "";
  }
  const tags: string[] = [];
  if (branding.light) {
    tags.push(`<link rel="stylesheet" href="/branding/theme.css?v=${version(branding)}" />`);
  }
  if (branding.favicon) {
    const type = TYPES[extname(branding.favicon).toLowerCase()] ?? "image/png";
    tags.push(`<link rel="icon" type="${type}" href="${escapeAttr(brandingUrl(branding, branding.favicon))}" />`);
  }
  tags.push(`<meta name="bakorin-branding" content="${escapeAttr(JSON.stringify(publicBranding(ast)))}" />`);
  return tags.join("\n    ");
}

/** Adds branding to an HTML document. Returns the input unchanged when there is no branding. */
export function injectBranding(html: string, ast: SchemaAST, title: (name: string) => string): string {
  if (!ast.branding) {
    return html;
  }
  const name = brandName(ast.appName, ast.branding);
  return html
    .replace(/<title>[^<]*<\/title>/, `<title>${escapeAttr(title(name))}</title>`)
    .replace("</head>", `    ${brandingHead(ast)}\n  </head>`);
}

export function createBrandingRoutes(): Hono {
  const app = new Hono();
  app.get("/theme.css", (c) => {
    const css = brandingCss(c.get("app").ast.branding);
    if (!css) {
      return c.notFound();
    }
    return new Response(css, {
      headers: { "content-type": "text/css; charset=utf-8", "cache-control": "public, max-age=300" },
    });
  });
  app.get("/:file", (c) => {
    const { ast, projectDir } = c.get("app");
    const branding = ast.branding;
    const name = c.req.param("file");
    const file = [branding?.logo, branding?.favicon].find((value) => value && basename(value) === name);
    if (!branding || !file) {
      return c.notFound();
    }
    const path = brandingFilePath(projectDir, file);
    if (!path || !existsSync(path)) {
      return c.notFound();
    }
    const headers: Record<string, string> = {
      "content-type": TYPES[extname(file).toLowerCase()] ?? "application/octet-stream",
      "cache-control": "public, max-age=300",
    };
    if (extname(file).toLowerCase() === ".svg") {
      // SVG can carry script; serve it as an inert image.
      headers["content-security-policy"] = "default-src 'none'; style-src 'unsafe-inline'; sandbox";
    }
    return new Response(readFileSync(path), { headers });
  });
  return app;
}

/** Brand values for system emails. Logo URLs are absolute because mail clients need them. */
export interface EmailBrand {
  name: string;
  primary?: string;
  primaryFg?: string;
  logoUrl?: string;
}

export function emailBrand(ast: SchemaAST): EmailBrand | undefined {
  const branding = ast.branding;
  if (!branding) {
    return undefined;
  }
  const base = ast.runtime.appUrl.replace(/\/$/, "");
  return {
    name: brandName(ast.appName, branding),
    primary: branding.email?.primary,
    primaryFg: branding.email?.primaryFg,
    logoUrl: branding.logo ? `${base}${brandingUrl(branding, branding.logo)}` : undefined,
  };
}

