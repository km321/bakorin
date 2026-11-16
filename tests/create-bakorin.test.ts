import { describe, expect, test } from "bun:test";
import { mkdtemp, readdir, writeFile } from "node:fs/promises";
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
    // Railway Infrastructure as Code replaces railway.json and railway.toml (not read after 2026-12-01).
    expect(await Bun.file(join(dir, "railway.json")).exists()).toBe(false);
    expect(await Bun.file(join(dir, "railway.toml")).exists()).toBe(false);
    const railway = await Bun.file(join(dir, ".railway", "railway.ts")).text();
    expect(railway).toContain('from "railway/iac"');
    expect(railway).toContain('builder: "DOCKERFILE"');
    expect(railway).toContain('healthcheck: "/health"');
    expect(railway).toContain('restartPolicyType: "ON_FAILURE", restartPolicyMaxRetries: 5');
    expect(railway).toContain('volumeMounts: { "/data": data }');
    expect(railway).toContain("variables: { managed: false }");
    expect(railway).toContain('service("demo"');
    expect(railway).not.toContain("{{APP_NAME}}");
    expect(await Bun.file(join(dir, ".railway", "README.md")).exists()).toBe(true);
    expect(await Bun.file(join(dir, "Dockerfile")).exists()).toBe(true);
    expect(await Bun.file(join(dir, ".env.example")).exists()).toBe(true);
    expect(await Bun.file(join(dir, "docker-compose.yml")).exists()).toBe(true);
    const env = await Bun.file(join(dir, ".env.example")).text();
    expect(env).toContain("MAIL_DRIVER=log");
    expect(env).toMatch(/^RESEND_API_KEY=$/m);
    expect(env).toContain("MAIL_FROM=demo <noreply@localhost>");
    expect(env).toContain("# --- Optional: production, Railway, S3, Postgres, extra mail ---");
    expect(env.indexOf("JWT_SECRET=")).toBeLessThan(env.indexOf("# --- Optional"));
    const compose = await Bun.file(join(dir, "docker-compose.yml")).text();
    expect(compose).toContain("RESEND_API_KEY: ${RESEND_API_KEY:-}");
    expect(compose).toContain("MAIL_FROM: ${MAIL_FROM:-}");
    const dockerfile = await Bun.file(join(dir, "Dockerfile")).text();
    expect(dockerfile).toContain("/bakorin/packages/server/src/cli.ts");
    expect(dockerfile).not.toContain("bunx");
    expect(dockerfile).toContain("COPY branding ./branding");
    expect(dockerfile).toContain("COPY mail ./mail");
    expect(await Bun.file(join(dir, "mail/README.md")).exists()).toBe(true);
    const brandingNotes = await Bun.file(join(dir, "branding/README.md")).text();
    expect(brandingNotes).toContain('primaryColor: "#0f766e"');
    expect(await Bun.file(join(dir, ".bakorin/packages/server/src/cli.ts")).exists()).toBe(true);
    expect(await Bun.file(join(dir, ".dockerignore")).exists()).toBe(true);
    const readme = await Bun.file(join(dir, "README.md")).text();
    expect(readme).toContain("create your first admin");
    expect(readme).not.toContain("docs/quickstart.md");
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

  test("--help and -h print usage and write nothing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "create-help-"));
    for (const flag of ["--help", "-h"]) {
      const proc = Bun.spawn(["bun", join(import.meta.dir, "../packages/create-bakorin/src/cli.ts"), flag, "--dir", dir], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      expect(code).toBe(0);
      expect(stderr).toBe("");
      expect(stdout).toContain("create-bakorin [name] [options]");
      expect(stdout).toContain("--force");
      expect(await Bun.file(join(dir, "app.yaml")).exists()).toBe(false);
    }
  });

  test("refuses a non-empty folder unless --force", async () => {
    const dir = await mkdtemp(join(tmpdir(), "create-force-"));
    await writeFile(join(dir, "keep.txt"), "nope");
    const blocked = Bun.spawn(
      [
        "bun",
        join(import.meta.dir, "../packages/create-bakorin/src/cli.ts"),
        "demo",
        "--dir",
        dir,
        "--frontend",
        "none",
        "--yes",
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    const [blockedErr, blockedCode] = await Promise.all([new Response(blocked.stderr).text(), blocked.exited]);
    expect(blockedCode).toBe(1);
    expect(blockedErr).toContain("non-empty");
    expect(await Bun.file(join(dir, "keep.txt")).text()).toBe("nope");
    expect(await Bun.file(join(dir, "app.yaml")).exists()).toBe(false);

    await scaffold(dir, ["--force"]);
    expect(await Bun.file(join(dir, "app.yaml")).exists()).toBe(true);
    expect(await Bun.file(join(dir, "keep.txt")).text()).toBe("nope");
  });

  test("from a checkout, web SDK uses a file: path to packages/sdk", async () => {
    const dir = await mkdtemp(join(tmpdir(), "create-sdk-"));
    const proc = Bun.spawn(
      [
        "bun",
        join(import.meta.dir, "../packages/create-bakorin/src/cli.ts"),
        "demo",
        "--dir",
        dir,
        "--frontend",
        "astro",
        "--schema",
        "todo",
        "--yes",
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
    expect(stdout).toContain("SDK: local");
    const pkg = (await Bun.file(join(dir, "web/package.json")).json()) as { dependencies: { "@bakorin/sdk": string } };
    expect(pkg.dependencies["@bakorin/sdk"].startsWith("file:")).toBe(true);
    expect(pkg.dependencies["@bakorin/sdk"]).toContain("packages/sdk");
    const webReadme = await Bun.file(join(dir, "web/README.md")).text();
    expect(webReadme).toContain("cd web");
    expect(webReadme).not.toContain("examples/astro-starter");
  });

  for (const frontend of ["astro", "next"] as const) {
    test(`generated ${frontend} project has no license field and no LICENSE file`, async () => {
      const dir = await mkdtemp(join(tmpdir(), `create-nolicense-${frontend}-`));
      const proc = Bun.spawn(
        [
          "bun",
          join(import.meta.dir, "../packages/create-bakorin/src/cli.ts"),
          "demo",
          "--dir",
          dir,
          "--frontend",
          frontend,
          "--schema",
          "todo",
          "--yes",
        ],
        { stdout: "pipe", stderr: "pipe" },
      );
      expect(await proc.exited).toBe(0);
      const pkg = (await Bun.file(join(dir, "web/package.json")).json()) as Record<string, unknown>;
      expect("license" in pkg).toBe(false);
      const licenseLike = /^(licen[cs]e|copying)(\.(md|txt))?$/i;
      for (const folder of [dir, join(dir, "web")]) {
        const names = await readdir(folder);
        expect(names.filter((name) => licenseLike.test(name))).toEqual([]);
      }
      if (await Bun.file(join(dir, "package.json")).exists()) {
        const rootPkg = (await Bun.file(join(dir, "package.json")).json()) as Record<string, unknown>;
        expect("license" in rootPkg).toBe(false);
      }
    });
  }

  test("--sdk npm writes the unpublished npm spec", async () => {
    const dir = await mkdtemp(join(tmpdir(), "create-npm-"));
    const proc = Bun.spawn(
      [
        "bun",
        join(import.meta.dir, "../packages/create-bakorin/src/cli.ts"),
        "demo",
        "--dir",
        dir,
        "--frontend",
        "astro",
        "--schema",
        "todo",
        "--sdk",
        "npm",
        "--yes",
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    const code = await proc.exited;
    expect(code).toBe(0);
    const pkg = (await Bun.file(join(dir, "web/package.json")).json()) as { dependencies: { "@bakorin/sdk": string } };
    expect(pkg.dependencies["@bakorin/sdk"]).toBe("^0.0.1");
    const dockerfile = await Bun.file(join(dir, "Dockerfile")).text();
    expect(dockerfile).toContain("bunx");
    expect(dockerfile).toContain("COPY branding ./branding");
    expect(dockerfile).toContain("COPY mail ./mail");
    expect(await Bun.file(join(dir, ".bakorin/package.json")).exists()).toBe(false);
  });

  test("bun run create --help works from the workspace root", async () => {
    const proc = Bun.spawn(["bun", "run", "create", "--help"], {
      cwd: join(import.meta.dir, ".."),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    expect(code).toBe(0);
    expect(stdout).toContain("create-bakorin [name] [options]");
  });
});
