import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function scaffold(dir: string, extra: string[] = []): Promise<string> {
  const proc = Bun.spawn(
    [
      "bun",
      join(import.meta.dir, "../packages/create-bakorin/src/cli.ts"),
      "demo",
      "--dir",
      dir,
      "--frontend",
      "none",
      "--schema",
      "todo",
      "--yes",
      ...extra,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  expect(code).toBe(0);
  expect(stderr).toBe("");
  return stdout;
}

describe("create-bakorin", () => {
  test("non-interactive scaffold writes app.yaml and railway files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "create-bakorin-"));
    await scaffold(dir);
    const yaml = await Bun.file(join(dir, "app.yaml")).text();
    expect(yaml).toContain("name: demo");
    expect(yaml).toContain("tasks:");
    expect(await Bun.file(join(dir, "railway.json")).exists()).toBe(true);
    expect(await Bun.file(join(dir, "railway.toml")).exists()).toBe(true);
    expect(await Bun.file(join(dir, "Dockerfile")).exists()).toBe(true);
    expect(await Bun.file(join(dir, ".env.example")).exists()).toBe(true);
    expect(await Bun.file(join(dir, "docker-compose.yml")).exists()).toBe(true);
    const env = await Bun.file(join(dir, ".env.example")).text();
    expect(env).toContain("MAIL_DRIVER=log");
    expect(env).toMatch(/^RESEND_API_KEY=$/m);
    expect(env).toContain("MAIL_FROM=demo <noreply@localhost>");
    const compose = await Bun.file(join(dir, "docker-compose.yml")).text();
    expect(compose).toContain("RESEND_API_KEY: ${RESEND_API_KEY:-}");
    expect(compose).toContain("MAIL_FROM: ${MAIL_FROM:-}");
  });

  test("--mail resend writes MAIL_DRIVER, MAIL_FROM, and an empty RESEND_API_KEY placeholder", async () => {
    const dir = await mkdtemp(join(tmpdir(), "create-bakorin-"));
    const stdout = await scaffold(dir, ["--mail", "resend"]);
    expect(stdout).toContain("Mail: resend");
    const env = await Bun.file(join(dir, ".env.example")).text();
    expect(env).toContain("MAIL_DRIVER=resend");
    expect(env).toContain("MAIL_FROM=demo <noreply@your-domain.com>");
    expect(env).toMatch(/^RESEND_API_KEY=$/m);
    expect(env).toContain("Never commit a real key");
    expect(env).not.toMatch(/re_[A-Za-z0-9]/);
    expect(env).not.toMatch(/RESEND_API_KEY=.+/);
  });

  test("--email smtp writes MAIL_DRIVER=smtp and SMTP placeholders", async () => {
    const dir = await mkdtemp(join(tmpdir(), "create-bakorin-"));
    await scaffold(dir, ["--email", "smtp"]);
    const env = await Bun.file(join(dir, ".env.example")).text();
    expect(env).toContain("MAIL_DRIVER=smtp");
    expect(env).toContain("SMTP_HOST=");
    expect(env).toMatch(/^RESEND_API_KEY=$/m);
  });
});
