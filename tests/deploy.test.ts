import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { compileAppYaml } from "@bakorin/core";
import { createRuntime } from "@bakorin/server";
import { MINI_YAML, boot, client, tempProject } from "./helpers.ts";

const PROD_SECRET = "prod-secret-prod-secret-prod-secret-ok";

describe("production deploy env", () => {
  test("PORT, BAKORIN_DATA_DIR, and Railway S3 env compile into the AST", () => {
    const ast = compileAppYaml(MINI_YAML, {
      production: true,
      env: {
        JWT_SECRET: PROD_SECRET,
        PORT: "8080",
        BAKORIN_DATA_DIR: "/data",
        AWS_ENDPOINT_URL: "https://t3.storage.railway.app",
        AWS_ACCESS_KEY_ID: "key",
        AWS_SECRET_ACCESS_KEY: "secret",
        AWS_DEFAULT_REGION: "auto",
        BUCKET: "studio-files",
        S3_FORCE_PATH_STYLE: "true",
      },
    });
    expect(ast.runtime.port).toBe(8080);
    expect(ast.runtime.sqlitePath).toBe("/data/app.db");
    expect(ast.runtime.files.driver).toBe("s3");
    expect(ast.runtime.files.path).toBe("./data/uploads");
    expect(ast.runtime.files.bucket).toBe("studio-files");
    expect(ast.runtime.files.endpoint).toBe("https://t3.storage.railway.app");
    expect(ast.runtime.files.accessKey).toBe("key");
    expect(ast.runtime.files.secretKey).toBe("secret");
    expect(ast.runtime.files.region).toBe("auto");
    expect(ast.runtime.files.virtualHostedStyle).toBe(false);
    expect(ast.runtime.backups.destination).toBe("s3://studio-files/backups");
  });

  test("S3_BUCKET and S3_ENDPOINT aliases still work", () => {
    const ast = compileAppYaml(MINI_YAML, {
      env: {
        JWT_SECRET: PROD_SECRET,
        S3_BUCKET: "alt-bucket",
        S3_ENDPOINT: "https://s3.example.test",
        S3_ACCESS_KEY: "ak",
        S3_SECRET_KEY: "sk",
        S3_REGION: "us-east-1",
      },
    });
    expect(ast.runtime.files.driver).toBe("s3");
    expect(ast.runtime.files.bucket).toBe("alt-bucket");
    expect(ast.runtime.files.endpoint).toBe("https://s3.example.test");
    expect(ast.runtime.files.accessKey).toBe("ak");
    expect(ast.runtime.files.secretKey).toBe("sk");
    expect(ast.runtime.files.region).toBe("us-east-1");
  });

  test("virtual-hosted vs path-style is configurable", () => {
    const pathStyle = compileAppYaml(MINI_YAML, {
      env: { JWT_SECRET: PROD_SECRET, S3_ADDRESSING_STYLE: "path" },
    });
    expect(pathStyle.runtime.files.virtualHostedStyle).toBe(false);
    const virtual = compileAppYaml(MINI_YAML, {
      env: { JWT_SECRET: PROD_SECRET, S3_VIRTUAL_HOSTED_STYLE: "true" },
    });
    expect(virtual.runtime.files.virtualHostedStyle).toBe(true);
    const forced = compileAppYaml(MINI_YAML, {
      env: { JWT_SECRET: PROD_SECRET, S3_FORCE_PATH_STYLE: "false" },
    });
    expect(forced.runtime.files.virtualHostedStyle).toBe(true);
  });

  test("GET /health and /healthz return ok", async () => {
    const runtime = await boot();
    const health = await client(runtime).fetch("/health");
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ ok: true, app: "mini" });
    const healthz = await client(runtime).fetch("/healthz");
    expect(healthz.status).toBe(200);
    await runtime.close();
  });

  test("seeds BAKORIN_ADMIN_* only on first boot", async () => {
    const dir = await tempProject();
    const yamlSource = await Bun.file(join(dir, "app.yaml")).text();
    const env = {
      JWT_SECRET: "test-secret-test-secret-test-secret-32",
      BAKORIN_ADMIN_EMAIL: "ada@studio.test",
      BAKORIN_ADMIN_PASSWORD: "password123",
      BAKORIN_ADMIN_NAME: "Ada West",
    };
    const first = await createRuntime({ projectDir: dir, yamlSource, env });
    const users = await first.db.selectFrom("users").selectAll().execute();
    expect(users).toHaveLength(1);
    expect(users[0]?.email).toBe("ada@studio.test");
    expect(users[0]?.name).toBe("Ada West");
    expect(users[0]?.role).toBe("admin");
    const login = await first.app.request("/api/v1/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "seed-1" },
      body: JSON.stringify({ email: "ada@studio.test", password: "password123" }),
    });
    expect(login.status).toBe(200);
    await first.close();

    const second = await createRuntime({ projectDir: dir, yamlSource, env });
    const again = await second.db.selectFrom("users").selectAll().execute();
    expect(again).toHaveLength(1);
    expect(again[0]?.id).toBe(users[0]?.id);
    await second.close();
  });

  test("refuses CORS * in production unless BAKORIN_ALLOW_ANY_ORIGIN", async () => {
    const dir = await tempProject();
    const yamlSource = await Bun.file(join(dir, "app.yaml")).text();
    await expect(
      createRuntime({
        projectDir: dir,
        yamlSource,
        env: { NODE_ENV: "production", JWT_SECRET: PROD_SECRET },
      }),
    ).rejects.toThrow(/CORS origin/);

    const allowed = await createRuntime({
      projectDir: dir,
      yamlSource,
      env: {
        NODE_ENV: "production",
        JWT_SECRET: PROD_SECRET,
        CORS_ORIGINS: "https://app.test",
      },
    });
    const preflight = await allowed.app.request("/api/v1/auth/login", {
      method: "OPTIONS",
      headers: {
        origin: "https://app.test",
        "access-control-request-method": "POST",
        "access-control-request-headers": "authorization,content-type",
      },
    });
    expect(preflight.headers.get("access-control-allow-origin")).toBe("https://app.test");
    expect(preflight.headers.get("access-control-allow-credentials")).toBe("true");
    expect(preflight.headers.get("access-control-allow-headers")?.toLowerCase()).toContain("authorization");
    const denied = await allowed.app.request("/api/v1/auth/login", {
      method: "OPTIONS",
      headers: {
        origin: "https://evil.test",
        "access-control-request-method": "POST",
      },
    });
    expect(denied.headers.get("access-control-allow-origin")).not.toBe("https://evil.test");
    await allowed.close();

    const wildcard = await createRuntime({
      projectDir: await tempProject(),
      yamlSource: MINI_YAML,
      env: {
        NODE_ENV: "production",
        JWT_SECRET: PROD_SECRET,
        BAKORIN_ALLOW_ANY_ORIGIN: "true",
      },
    });
    expect(wildcard.ast.runtime.corsOrigins).toEqual(["*"]);
    await wildcard.close();
  });

  test("does not seed when admin env is unset", async () => {
    const dir = await tempProject();
    const runtime = await createRuntime({
      projectDir: dir,
      yamlSource: await Bun.file(join(dir, "app.yaml")).text(),
      env: { JWT_SECRET: "test-secret-test-secret-test-secret-32" },
    });
    const users = await runtime.db.selectFrom("users").selectAll().execute();
    expect(users).toHaveLength(0);
    await runtime.close();
  });
});
