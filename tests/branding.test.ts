import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BRANDING_SURFACES,
  brandingCss,
  compileAppYaml,
  compileBranding,
  contrastRatio,
  serializeAst,
} from "@bakorin/core";
import { createRuntime, restoreProjectAssets } from "@bakorin/server";
import { copyProjectFiles } from "../packages/server/src/backup/archive.ts";
import { renderAccountEmail } from "../packages/server/src/mail/templates.ts";
import pageHtml from "../packages/server/src/docs/page.html" with { type: "text" };
import { client, MINI_YAML, tempProject } from "./helpers.ts";

const ENV = { env: {}, production: false };
const LOGO = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#0f766e"/></svg>\n`;

function withBranding(block: string, yaml = MINI_YAML): string {
  return yaml.replace("\nruntime:", `\nbranding:\n${block}\nruntime:`);
}

const BRANDED = withBranding(
  [
    "  name: Northwind Studio",
    '  primaryColor: "#0f766e"',
    '  accentColor: "#f59e0b"',
    "  logo: branding/logo.svg",
    "  favicon: ./branding/favicon.png",
  ].join("\n"),
);

async function brandedProject(yaml = BRANDED): Promise<string> {
  const dir = await tempProject(yaml);
  await mkdir(join(dir, "branding"), { recursive: true });
  await writeFile(join(dir, "branding", "logo.svg"), LOGO);
  await writeFile(join(dir, "branding", "favicon.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  return dir;
}

function schemaError(yaml: string): string {
  try {
    compileAppYaml(yaml, ENV);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return "";
}

describe("branding: default is unchanged", () => {
  test("no branding section means no branding anywhere", async () => {
    const ast = compileAppYaml(MINI_YAML, ENV);
    expect(ast.branding).toBeUndefined();
    expect(serializeAst(ast)).not.toContain("branding");
    expect(brandingCss(ast.branding)).toBe("");

    const dir = await tempProject();
    const runtime = await createRuntime({ projectDir: dir, yamlSource: MINI_YAML });
    try {
      const http = client(Object.assign(runtime, { dir }));
      const admin = await (await http.fetch("/admin/")).text();
      expect(admin).toContain("<title>Bakorin Admin</title>");
      expect(admin).not.toContain("bakorin-branding");
      expect(admin).not.toContain("/branding/");
      const docs = await (await http.fetch("/docs")).text();
      expect(docs).toBe(pageHtml);
      expect((await http.fetch("/branding/theme.css")).status).toBe(404);
      expect((await http.fetch("/branding/logo.svg")).status).toBe(404);
    } finally {
      await runtime.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("system emails without branding keep the original markup", () => {
    const mail = renderAccountEmail("verify", { appName: "mini", link: "https://x.test/verify-email?token=t" });
    expect(mail.subject).toBe("Verify your mini email");
    expect(mail.html).toBe(`<!doctype html>
<html>
  <body style="font-family: sans-serif; line-height: 1.5; color: #111;">
    <p style="font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; color: #666;">mini</p>
    <h1 style="font-size: 20px;">Verify your email</h1>
    <p>Confirm this address to finish setting up your mini account. This link expires in 24 hours.</p><p><a href="https://x.test/verify-email?token=t">https://x.test/verify-email?token=t</a></p>
  </body>
</html>`);
  });
});

describe("branding: contrast", () => {
  function assertPalettePasses(color: string): void {
    const branding = compileBranding({ primaryColor: color })!;
    for (const theme of ["light", "dark"] as const) {
      const palette = branding[theme]!;
      const spec = BRANDING_SURFACES[theme];
      for (const surface of spec.surfaces) {
        expect(contrastRatio(palette.accent, surface)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(palette.focus, surface)).toBeGreaterThanOrEqual(3);
      }
      expect(contrastRatio(palette.accentFg, palette.accent)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(spec.text, palette.accentSoft)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(spec.muted, palette.accentSoft)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(palette.accent, palette.accentSoft)).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrastRatio(branding.email!.primary, "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(branding.email!.primaryFg, branding.email!.primary)).toBeGreaterThanOrEqual(4.5);
  }

  test("a color that fails AA is adjusted, with a warning per theme", () => {
    const branding = compileBranding({ primaryColor: "#ffcc00" })!;
    expect(branding.primaryColor).toBe("#ffcc00");
    expect(branding.light!.accent).not.toBe("#ffcc00");
    expect(branding.dark!.accent).toBe("#ffcc00");
    expect(branding.warnings).toHaveLength(1);
    expect(branding.warnings[0]).toContain("branding.primaryColor #ffcc00");
    expect(branding.warnings[0]).toContain("4.5:1");
    expect(branding.warnings[0]).toContain(`Using ${branding.light!.accent}`);
    assertPalettePasses("#ffcc00");
  });

  test("a color that already passes is kept and does not warn for that theme", () => {
    const branding = compileBranding({ primaryColor: "#1e3a8a" })!;
    expect(branding.light!.accent).toBe("#1e3a8a");
    expect(branding.warnings.some((warning) => warning.includes("light theme"))).toBe(false);
    expect(branding.warnings.some((warning) => warning.includes("dark theme"))).toBe(true);
  });

  test("an accent that is too faint for focus rings is adjusted and reported", () => {
    const branding = compileBranding({ primaryColor: "#1e3a8a", accentColor: "#fde68a" })!;
    expect(branding.light!.focus).not.toBe("#fde68a");
    expect(branding.warnings.some((warning) => warning.includes("branding.accentColor #fde68a") && warning.includes("3:1"))).toBe(
      true,
    );
  });

  test("every generated palette meets AA for a spread of colors", () => {
    const colors = ["#000000", "#ffffff", "#808080", "#ff0000", "#00ff00", "#0000ff", "#e11d48", "#0f766e", "#7c3aed", "#f97316", "#abc"];
    for (let hue = 0; hue < 360; hue += 30) {
      colors.push(`#${[0, 8, 4].map((n) => {
        const k = (n + hue / 30) % 12;
        const v = 0.5 - 0.5 * Math.max(-1, Math.min(k - 3, 9 - k, 1));
        return Math.round(v * 255).toString(16).padStart(2, "0");
      }).join("")}`);
    }
    for (const color of colors) {
      assertPalettePasses(color);
    }
  });
});

describe("branding: validation", () => {
  test("bad values are schema errors with the path", () => {
    expect(schemaError(withBranding('  primaryColor: "teal"'))).toContain("branding.primaryColor");
    expect(schemaError(withBranding('  primaryColor: "teal"'))).toContain("hex color");
    expect(schemaError(withBranding("  primaryColor: #0f766e"))).toContain("quoted hex color");
    expect(schemaError(withBranding("  logo: ../secrets/logo.svg"))).toContain("branding/ folder");
    expect(schemaError(withBranding("  logo: /etc/logo.svg"))).toContain("branding.logo");
    expect(schemaError(withBranding("  logo: branding/logo.gif"))).toContain("branding.logo");
    expect(schemaError(withBranding("  favicon: branding/sub/favicon.png"))).toContain("branding.favicon");
    expect(schemaError(withBranding("  color: red"))).toContain("branding");
    expect(schemaError(MINI_YAML.replace("\nruntime:", "\nbranding: {}\nruntime:"))).toContain("at least one");
  });

  test("a missing logo file stops boot with a clear message", async () => {
    const dir = await tempProject(BRANDED);
    try {
      await expect(createRuntime({ projectDir: dir, yamlSource: BRANDED })).rejects.toThrow(
        "branding.logo: branding/logo.svg does not exist",
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("branding: applied", () => {
  test("admin, docs, files, and system emails use the brand", async () => {
    const dir = await brandedProject();
    const runtime = await createRuntime({ projectDir: dir, yamlSource: BRANDED });
    try {
      const http = client(Object.assign(runtime, { dir }));
      const admin = await (await http.fetch("/admin/")).text();
      expect(admin).toContain("<title>Northwind Studio Admin</title>");
      expect(admin).toMatch(/<link rel="stylesheet" href="\/branding\/theme\.css\?v=[0-9a-f]+" \/>/);
      expect(admin).toMatch(/<link rel="icon" type="image\/png" href="\/branding\/favicon\.png\?v=/);
      expect(admin).toContain('<meta name="bakorin-branding" content="{&quot;name&quot;:&quot;Northwind Studio&quot;');

      const css = await http.fetch("/branding/theme.css");
      expect(css.status).toBe(200);
      const cssText = await css.text();
      expect(cssText).toContain(`--accent: ${runtime.ast.branding!.light!.accent};`);
      expect(cssText).toContain(`--docs-accent: ${runtime.ast.branding!.dark!.accent};`);

      const logo = await http.fetch("/branding/logo.svg");
      expect(logo.status).toBe(200);
      expect(logo.headers.get("content-type")).toBe("image/svg+xml");
      expect(logo.headers.get("content-security-policy")).toContain("sandbox");
      expect(await logo.text()).toBe(LOGO);
      const favicon = await http.fetch("/branding/favicon.png");
      expect(favicon.headers.get("content-type")).toBe("image/png");
      expect((await http.fetch("/branding/app.yaml")).status).toBe(404);
      expect((await http.fetch("/branding/..%2Fapp.yaml")).status).toBe(404);
      await writeFile(join(dir, "branding", "notes.txt"), "private");
      expect((await http.fetch("/branding/notes.txt")).status).toBe(404);

      const docs = await (await http.fetch("/docs")).text();
      expect(docs).toContain("<title>Northwind Studio API docs</title>");
      expect(docs).toContain("<strong>Northwind Studio</strong>");
      expect(docs).toContain('class="docs-brand-logo" src="/branding/logo.svg?v=');

      const first = await http.fetch("/api/v1/auth/first-admin", {
        method: "POST",
        body: JSON.stringify({ email: "ada@example.com", password: "password123", name: "Ada" }),
      });
      const token = ((await first.json()) as { data: { accessToken: string } }).data.accessToken;
      const preview = await client(Object.assign(runtime, { dir }), token).fetch("/api/v1/mail/preview", {
        method: "POST",
        body: JSON.stringify({ template: "_auth/invite" }),
      });
      expect(preview.status).toBe(200);
      const mail = ((await preview.json()) as { data: { subject: string; html: string } }).data;
      expect(mail.subject).toBe("You are invited to Northwind Studio");
      expect(mail.html).toContain(`${runtime.ast.runtime.appUrl}/branding/logo.svg?v=`);
      expect(mail.html).toContain(`background: ${runtime.ast.branding!.email!.primary}`);
      expect(mail.html).toContain("Set your password");
    } finally {
      await runtime.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("backups carry the branding folder and restore puts it back", async () => {
    const dir = await brandedProject();
    const backup = await mkdtemp(join(tmpdir(), "bakorin-brand-backup-"));
    const fresh = await mkdtemp(join(tmpdir(), "bakorin-brand-fresh-"));
    try {
      await copyProjectFiles(dir, backup);
      expect(await readFile(join(backup, "branding", "logo.svg"), "utf8")).toBe(LOGO);
      expect(await readFile(join(backup, "app.yaml"), "utf8")).toContain("Northwind Studio");

      await writeFile(join(fresh, "app.yaml"), BRANDED);
      const restored = await restoreProjectAssets(backup, fresh);
      expect(restored.sort()).toEqual(["favicon.png", "logo.svg"]);
      expect(await readFile(join(fresh, "branding", "logo.svg"), "utf8")).toBe(LOGO);
      expect(await restoreProjectAssets(join(fresh, "nowhere"), fresh)).toEqual([]);
    } finally {
      for (const path of [dir, backup, fresh]) {
        await rm(path, { recursive: true, force: true });
      }
    }
  });
});
