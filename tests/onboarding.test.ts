import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRuntime } from "@bakorin/server";
import { boot, client, tempProject } from "./helpers.ts";

describe("first admin onboarding", () => {
  test("GET /api/v1/auth/setup is true until an admin exists", async () => {
    const runtime = await boot();
    const http = client(runtime);
    const setup = await http.fetch("/api/v1/auth/setup");
    expect(setup.status).toBe(200);
    expect(await setup.json()).toEqual({ data: { firstAdmin: true } });

    const created = await http.fetch("/api/v1/auth/first-admin", {
      method: "POST",
      body: JSON.stringify({ email: "owner@studio.test", password: "password123", name: "Owner" }),
    });
    expect(created.status).toBe(201);
    const payload = (await created.json()) as { data: { accessToken: string; user: { email: string; role: string } } };
    expect(payload.data.user.email).toBe("owner@studio.test");
    expect(payload.data.user.role).toBe("admin");
    expect(payload.data.accessToken).toBeTruthy();

    const again = await http.fetch("/api/v1/auth/setup");
    expect(await again.json()).toEqual({ data: { firstAdmin: false } });

    const refused = await http.fetch("/api/v1/auth/first-admin", {
      method: "POST",
      body: JSON.stringify({ email: "other@studio.test", password: "password123" }),
    });
    expect(refused.status).toBe(409);
    const users = await runtime.db.selectFrom("users").selectAll().execute();
    expect(users).toHaveLength(1);
    await runtime.close();
  });

  test("first-admin requires 8 character password", async () => {
    const runtime = await boot();
    const http = client(runtime);
    const short = await http.fetch("/api/v1/auth/first-admin", {
      method: "POST",
      body: JSON.stringify({ email: "owner@studio.test", password: "short" }),
    });
    expect(short.status).toBe(400);
    const users = await runtime.db.selectFrom("users").selectAll().execute();
    expect(users).toHaveLength(0);
    await runtime.close();
  });

  test("two concurrent first-admin posts create only one admin", async () => {
    const runtime = await boot();
    const http = client(runtime);
    const bodyA = JSON.stringify({ email: "a@studio.test", password: "password123" });
    const bodyB = JSON.stringify({ email: "b@studio.test", password: "password123" });
    const [one, two] = await Promise.all([
      http.fetch("/api/v1/auth/first-admin", {
        method: "POST",
        headers: { "x-forwarded-for": "203.0.113.10" },
        body: bodyA,
      }),
      http.fetch("/api/v1/auth/first-admin", {
        method: "POST",
        headers: { "x-forwarded-for": "203.0.113.11" },
        body: bodyB,
      }),
    ]);
    const statuses = [one.status, two.status].sort();
    expect(statuses).toEqual([201, 409]);
    const users = await runtime.db.selectFrom("users").selectAll().execute();
    expect(users).toHaveLength(1);
    expect(users[0]?.role).toBe("admin");
    await runtime.close();
  });

  test("first-admin stays open when only non-admin users exist", async () => {
    const runtime = await boot();
    const http = client(runtime);
    const signup = await http.fetch("/api/v1/auth/signup", {
      method: "POST",
      body: JSON.stringify({ email: "member@studio.test", password: "password123", name: "Member" }),
    });
    expect(signup.status).toBe(201);
    const setup = await http.fetch("/api/v1/auth/setup");
    expect(await setup.json()).toEqual({ data: { firstAdmin: true } });
    const created = await http.fetch("/api/v1/auth/first-admin", {
      method: "POST",
      body: JSON.stringify({ email: "owner@studio.test", password: "password123" }),
    });
    expect(created.status).toBe(201);
    const users = await runtime.db.selectFrom("users").selectAll().execute();
    expect(users).toHaveLength(2);
    expect(users.filter((row) => row.role === "admin")).toHaveLength(1);
    await runtime.close();
  });

  test("seeding failure logs instead of crashing startup", async () => {
    const dir = await tempProject();
    const yamlSource = await Bun.file(join(dir, "app.yaml")).text();
    const errors: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
    };
    try {
      const runtime = await createRuntime({
        projectDir: dir,
        yamlSource,
        env: {
          JWT_SECRET: "test-secret-test-secret-test-secret-32",
          BAKORIN_ADMIN_EMAIL: "ada@studio.test",
          BAKORIN_ADMIN_PASSWORD: "short",
        },
      });
      const users = await runtime.db.selectFrom("users").selectAll().execute();
      expect(users).toHaveLength(0);
      expect(errors.some((line) => line.includes("admin seeding failed"))).toBe(true);
      expect(errors.some((line) => line.includes("BAKORIN_ADMIN_PASSWORD"))).toBe(true);
      await runtime.close();
    } finally {
      console.error = original;
    }
  });
});

describe("CLI project .env", () => {
  test("typegen loads JWT_SECRET from --dir .env", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cli-env-"));
    await writeFile(
      join(dir, "app.yaml"),
      `
app:
  name: envapp
runtime:
  dialect: sqlite
  sqlite:
    path: ./data/app.db
  jwt:
    secret: \${JWT_SECRET}
auth:
  entity: users
entities:
  users:
    auth: true
    fields:
      email: { type: email, unique: true, required: true }
      password: { type: password, required: true }
      role: { type: enum, values: [user, admin], default: user }
`,
    );
    await writeFile(join(dir, "hooks.ts"), "export default { entities: {} };\n");
    await mkdir(join(dir, "data"), { recursive: true });
    await writeFile(join(dir, ".env"), "JWT_SECRET=dir-secret-dir-secret-dir-secret-32\n");
    const cwd = await mkdtemp(join(tmpdir(), "cli-cwd-"));
    const env = { ...process.env };
    delete env.JWT_SECRET;
    const proc = Bun.spawn(["bun", join(import.meta.dir, "../packages/server/src/cli.ts"), "typegen", "--dir", dir], {
      cwd,
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    expect(stderr).not.toContain("JWT_SECRET is required");
    expect(code).toBe(0);
    expect(stdout).toContain("wrote");
  });

  test("dev warns when using the default JWT secret", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cli-jwt-"));
    await writeFile(
      join(dir, "app.yaml"),
      `
app:
  name: jwtwarn
runtime:
  dialect: sqlite
  sqlite:
    path: ./data/app.db
  host: 127.0.0.1
  port: 43991
auth:
  entity: users
entities:
  users:
    auth: true
    fields:
      email: { type: email, unique: true, required: true }
      password: { type: password, required: true }
      role: { type: enum, values: [user, admin], default: user }
`,
    );
    await writeFile(join(dir, "hooks.ts"), "export default { entities: {} };\n");
    await mkdir(join(dir, "data"), { recursive: true });
    const env: Record<string, string | undefined> = { ...process.env, NODE_ENV: "development", BAKORIN_ENV: "development" };
    delete env.JWT_SECRET;
    const proc = Bun.spawn(["bun", join(import.meta.dir, "../packages/server/src/cli.ts"), "dev", "--dir", dir, "--port", "43991"], {
      cwd: dir,
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const stderrPromise = new Response(proc.stderr).text();
    const stdoutPromise = new Response(proc.stdout).text();
    const deadline = Date.now() + 8000;
    let sawWarn = false;
    while (Date.now() < deadline) {
      await Bun.sleep(100);
      try {
        const health = await fetch("http://127.0.0.1:43991/health");
        if (health.ok) {
          sawWarn = true;
          break;
        }
      } catch {
        // still booting
      }
    }
    proc.kill();
    const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);
    const combined = `${stdout}\n${stderr}`;
    expect(sawWarn || combined.includes("jwtwarn")).toBe(true);
    expect(combined).toContain("WARNING: using the default JWT secret");
  });
});
