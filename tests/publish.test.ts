import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const REPO = "git+https://github.com/km321/bakorin.git";

interface Pkg {
  name: string;
  version: string;
  license: string;
  private?: boolean;
  types?: string;
  files?: string[];
  exports?: unknown;
  publishConfig?: { access?: string; tag?: string };
  repository?: { type?: string; url?: string; directory?: string };
}

async function readPkg(relative: string): Promise<Pkg> {
  return (await Bun.file(join(ROOT, relative, "package.json")).json()) as Pkg;
}

describe("publish-ready packages", () => {
  const packages = [
    { dir: "packages/core", name: "@bakorin/core", directory: "packages/core", license: "AGPL-3.0-only" },
    { dir: "packages/sdk", name: "@bakorin/sdk", directory: "packages/sdk", license: "MIT" },
    { dir: "packages/server", name: "@bakorin/server", directory: "packages/server", license: "AGPL-3.0-only" },
    { dir: "packages/create-bakorin", name: "create-bakorin", directory: "packages/create-bakorin", license: "MIT" },
  ];

  for (const item of packages) {
    test(`${item.name} is 0.0.1 with public beta publishConfig`, async () => {
      const pkg = await readPkg(item.dir);
      expect(pkg.name).toBe(item.name);
      expect(pkg.version).toBe("0.0.1");
      expect(pkg.license).toBe(item.license);
      expect(pkg.private).toBeUndefined();
      expect(pkg.publishConfig).toEqual({ access: "public", tag: "beta" });
      expect(pkg.repository?.type).toBe("git");
      expect(pkg.repository?.url).toBe(REPO);
      expect(pkg.repository?.directory).toBe(item.directory);
      expect(pkg.types).toBeTruthy();
      expect(pkg.files?.length).toBeGreaterThan(0);
      expect(pkg.exports).toBeTruthy();
    });
  }

  test("admin-ui stays private", async () => {
    const pkg = await readPkg("packages/admin-ui");
    expect(pkg.private).toBe(true);
    expect(pkg.license).toBe("AGPL-3.0-only");
  });

  test("starters and templates are MIT", async () => {
    for (const dir of [
      "examples/astro-starter",
      "examples/next-starter",
      "packages/create-bakorin/templates/astro",
      "packages/create-bakorin/templates/next",
    ]) {
      const pkg = await readPkg(dir);
      expect(pkg.license).toBe("MIT");
    }
  });

  test("license files match the split", async () => {
    for (const dir of [".", "packages/server", "packages/core", "packages/admin-ui"]) {
      const text = await Bun.file(join(ROOT, dir, "LICENSE")).text();
      expect(text).toContain("GNU AFFERO GENERAL PUBLIC LICENSE");
    }
    for (const dir of ["packages/sdk", "packages/create-bakorin", "examples"]) {
      const text = await Bun.file(join(ROOT, dir, "LICENSE")).text();
      expect(text).toContain("MIT License");
      expect(text).toContain("Melton Studios");
    }
  });

  test("workspace root stays private", async () => {
    const pkg = await readPkg(".");
    expect(pkg.private).toBe(true);
    expect(pkg.name).toBe("bakorin");
  });
});
