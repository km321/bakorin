import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("create-bakorin", () => {
  test("non-interactive scaffold writes app.yaml and railway files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "create-bakorin-"));
    const proc = Bun.spawn(
      ["bun", join(import.meta.dir, "../packages/create-bakorin/src/cli.ts"), "demo", "--dir", dir, "--frontend", "none", "--schema", "todo", "--yes"],
      { stdout: "pipe", stderr: "pipe" },
    );
    expect(await proc.exited).toBe(0);
    const yaml = await Bun.file(join(dir, "app.yaml")).text();
    expect(yaml).toContain("name: demo");
    expect(yaml).toContain("tasks:");
    expect(await Bun.file(join(dir, "railway.json")).exists()).toBe(true);
    expect(await Bun.file(join(dir, "railway.toml")).exists()).toBe(true);
    expect(await Bun.file(join(dir, "Dockerfile")).exists()).toBe(true);
    expect(await Bun.file(join(dir, ".env.example")).exists()).toBe(true);
    expect(await Bun.file(join(dir, "docker-compose.yml")).exists()).toBe(true);
  });
});
