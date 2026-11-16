import { describe, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { compileAppYaml } from "@bakorin/core";
import { SCHEMAS, templateTypes } from "../scripts/template-types.ts";
import { starterDrift } from "../scripts/sync-starters.ts";

const CLI = join(import.meta.dir, "../packages/create-bakorin/src/cli.ts");
const TEMPLATES = resolve(import.meta.dir, "../packages/create-bakorin/templates");

async function scaffold(template: string, frontend: "astro" | "next"): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `create-bakorin-${template}-`));
  const proc = Bun.spawn(["bun", CLI, "demo", "--dir", dir, "--frontend", frontend, "--template", template, "--sdk", "local", "--yes", "--force"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stderr, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
  expect(stderr).toBe("");
  expect(code).toBe(0);
  return dir;
}

async function files(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".bakorin") continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await files(path)));
    else out.push(path);
  }
  return out;
}

const PAGES: Record<string, { astro: string[]; next: string[] }> = {
  blank: { astro: ["src/pages/index.astro", "src/pages/app/index.astro"], next: ["app/page.tsx", "app/app/page.tsx"] },
  "auth-only": { astro: ["src/pages/index.astro", "src/pages/app/index.astro"], next: ["app/page.tsx", "app/app/page.tsx"] },
  blog: {
    astro: ["src/pages/index.astro", "src/pages/posts/[slug].astro", "src/pages/categories/[slug].astro", "src/pages/write/index.astro", "src/pages/write/[id].astro"],
    next: ["app/page.tsx", "app/posts/[slug]/page.tsx", "app/categories/[slug]/page.tsx", "app/write/page.tsx", "app/write/[id]/page.tsx"],
  },
  marketing: {
    astro: ["src/pages/index.astro", "src/pages/about.astro", "src/pages/contact.astro", "src/pages/app/leads.astro"],
    next: ["app/page.tsx", "app/about/page.tsx", "app/contact/page.tsx", "app/app/leads/page.tsx"],
  },
  saas: {
    astro: ["src/pages/app/index.astro", "src/pages/app/projects/index.astro", "src/pages/app/projects/[id].astro", "src/pages/app/team.astro"],
    next: ["app/app/page.tsx", "app/app/projects/page.tsx", "app/app/projects/[id]/page.tsx", "app/app/team/page.tsx"],
  },
  store: {
    astro: ["src/pages/index.astro", "src/pages/products/[slug].astro", "src/pages/cart.astro", "src/pages/checkout/[id].astro", "src/pages/orders.astro", "src/pages/manage/index.astro"],
    next: ["app/page.tsx", "app/products/[slug]/page.tsx", "app/cart/page.tsx", "app/checkout/[id]/page.tsx", "app/orders/page.tsx", "app/manage/page.tsx"],
  },
};

const SCHEMA_OF: Record<string, string> = { blank: "blank", "auth-only": "auth", blog: "blog", marketing: "marketing", saas: "saas", store: "store" };

describe("create-bakorin templates", () => {
  test("the generated types in templates/gen match each schema (bun scripts/template-types.ts)", async () => {
    for (const schema of SCHEMAS) {
      expect(await readFile(join(TEMPLATES, "gen", `${schema}.gen.ts`), "utf8")).toBe(await templateTypes(schema));
    }
  });

  test("examples/*-starter match the templates (bun scripts/sync-starters.ts)", async () => {
    expect(await starterDrift("astro")).toEqual([]);
    expect(await starterDrift("next")).toEqual([]);
  });

  test("the Astro and Next overlays share the same lib files", async () => {
    for (const template of ["auth", "todo", "blog", "marketing", "saas", "store"]) {
      const astroLib = join(TEMPLATES, "overlays/astro", template, "src/lib");
      for (const name of await readdir(astroLib)) {
        expect(await readFile(join(TEMPLATES, "overlays/next", template, "lib", name), "utf8")).toBe(await readFile(join(astroLib, name), "utf8"));
      }
    }
  });

  for (const template of Object.keys(PAGES)) {
    for (const frontend of ["astro", "next"] as const) {
      test(`${template} with ${frontend}: its own schema, types, pages, and no task pages`, async () => {
        const dir = await scaffold(template, frontend);
        const schema = SCHEMA_OF[template]!;
        const yaml = await readFile(join(dir, "app.yaml"), "utf8");
        expect(() => compileAppYaml(yaml, { env: {}, production: false })).not.toThrow();
        const web = join(dir, "web");
        const gen = await readFile(join(web, frontend === "astro" ? "src/lib/bakorin.gen.ts" : "lib/bakorin.gen.ts"), "utf8");
        expect(gen).toBe(await templateTypes(schema));
        for (const page of PAGES[template]![frontend]) {
          expect(await Bun.file(join(web, page)).exists()).toBe(true);
        }
        // Nothing from the todo template is left behind.
        for (const path of await files(dir)) {
          const text = await readFile(path, "utf8").catch(() => "");
          expect({ file: relative(dir, path), tasks: /\btasks?\b/i.test(text) }).toEqual({ file: relative(dir, path), tasks: false });
        }
        const seeded = template !== "blank" && template !== "auth-only";
        expect(await Bun.file(join(dir, "seed.ts")).exists()).toBe(seeded);
        if (seeded) {
          const seed = await readFile(join(dir, "seed.ts"), "utf8");
          expect(seed).toContain("Example");
          // No invented prices in the example data.
          expect(seed).not.toMatch(/priceCents\s*:/);
        }
        const readme = await readFile(join(web, "README.md"), "utf8");
        expect(readme).toContain(`## Pages (${schema} template)`);
      });
    }
  }

  test("the store's order hook ships with the store only", async () => {
    const store = await scaffold("store", "astro");
    expect(await readFile(join(store, "hooks.ts"), "utf8")).toContain("afterCreate");
    const blog = await scaffold("blog", "astro");
    expect(await readFile(join(blog, "hooks.ts"), "utf8")).not.toContain("afterCreate");
  });

  test("template copy has no em or en dashes", async () => {
    const all = [...(await files(join(TEMPLATES, "overlays"))), ...(await files(join(TEMPLATES, "seeds"))), ...(await files(join(TEMPLATES, "schemas"))), ...(await files(join(TEMPLATES, "hooks")))];
    for (const path of all) {
      expect({ file: relative(TEMPLATES, path), dash: /[\u2013\u2014]/.test(await readFile(path, "utf8")) }).toEqual({ file: relative(TEMPLATES, path), dash: false });
    }
  });
});
