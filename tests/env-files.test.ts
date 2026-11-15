import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyProjectEnv, parseEnvFile } from "@bakorin/server";

describe("env files", () => {
  test("parseEnvFile skips comments and unwraps quotes", () => {
    const parsed = parseEnvFile(`
# comment
JWT_SECRET=from-file
MAIL_FROM="Demo <a@b.com>"
EMPTY=
`);
    expect(parsed.JWT_SECRET).toBe("from-file");
    expect(parsed.MAIL_FROM).toBe("Demo <a@b.com>");
    expect(parsed.EMPTY).toBe("");
  });

  test("project --dir .env overrides cwd .env", async () => {
    const root = await mkdtemp(join(tmpdir(), "env-root-"));
    const project = join(root, "app");
    await mkdir(project);
    await writeFile(join(root, ".env"), "JWT_SECRET=from-cwd\nSHARED=cwd\n");
    await writeFile(join(project, ".env"), "JWT_SECRET=from-dir\nDIR_ONLY=yes\n");
    const env: Record<string, string | undefined> = {};
    await applyProjectEnv(project, env, root);
    expect(env.JWT_SECRET).toBe("from-dir");
    expect(env.SHARED).toBe("cwd");
    expect(env.DIR_ONLY).toBe("yes");
  });

  test("does not override a real process env value from cwd file", async () => {
    const root = await mkdtemp(join(tmpdir(), "env-keep-"));
    const project = join(root, "app");
    await mkdir(project);
    await writeFile(join(root, ".env"), "ALREADY=from-file\n");
    const env: Record<string, string | undefined> = { ALREADY: "from-shell" };
    await applyProjectEnv(project, env, root);
    expect(env.ALREADY).toBe("from-shell");
  });
});
