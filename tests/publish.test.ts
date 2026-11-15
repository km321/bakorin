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
    { dir: "packages/core", name: "@bakorin/core", directory: "packages/core" },
    { dir: "packages/sdk", name: "@bakorin/sdk", directory: "packages/sdk" },
    { dir: "packages/server", name: "@bakorin/server", directory: "packages/server" },
    { dir: "packages/create-bakorin", name: "create-bakorin", directory: "packages/create-bakorin" },
  ];

  for (const item of packages) {
    test(`${item.name} is 0.0.1 with public beta publishConfig`, async () => {
      const pkg = await readPkg(item.dir);
      expect(pkg.name).toBe(item.name);
      expect(pkg.version).toBe("0.0.1");
      expect(pkg.license).toBe("MIT");
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
  });

  test("workspace root stays private", async () => {
    const pkg = await readPkg(".");
    expect(pkg.private).toBe(true);
    expect(pkg.name).toBe("bakorin");
  });
});
