import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRuntime, type RuntimeHandles } from "@bakorin/server";

export const MINI_YAML = `
app:
  name: mini
runtime:
  dialect: sqlite
  sqlite:
    path: ./data/app.db
  files:
    path: ./data/uploads
  jwt:
    secret: test-jwt-secret-0123456789-abcdefghijklmnop
  hooks: ./hooks.ts
auth:
  entity: users
  adminRole: admin
entities:
  users:
    auth: true
    fields:
      email: { type: email, unique: true, required: true }
      password: { type: password, required: true }
      name: { type: text, required: true }
      role: { type: enum, values: [user, admin], default: user }
    policies:
      read: authenticated
      create: public
      update: owner(id)
      delete: admin
  items:
    fields:
      title: { type: text, required: true }
      done: { type: boolean, default: false }
      ownerId: { type: relation, to: users, required: true }
    policies:
      read: owner(ownerId)
      create: authenticated
      update: owner(ownerId)
      delete: owner(ownerId)
`;

export async function tempProject(yaml = MINI_YAML, hooks = "export default { entities: {} };\n"): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "bakorin-"));
  await writeFile(join(dir, "app.yaml"), yaml);
  await writeFile(join(dir, "hooks.ts"), hooks);
  await mkdir(join(dir, "data"), { recursive: true });
  return dir;
}

/** Admin URL of the Postgres server the postgres only tests use, when one is configured. */
export const POSTGRES_URL =
  process.env.POSTGRES_TEST_URL ?? (/^postgres(ql)?:/.test(process.env.DATABASE_URL ?? "") ? process.env.DATABASE_URL : undefined);

/** Admin URL of the MySQL or MariaDB server the mysql only tests use, when one is configured. */
export const MYSQL_URL = process.env.MYSQL_TEST_URL ?? (/^m(ysql|ariadb):/.test(process.env.DATABASE_URL ?? "") ? process.env.DATABASE_URL : undefined);

/** Set by the CI matrix: run every boot() based test on Postgres too. */
export const TEST_DIALECT = ["postgres", "mysql", "mariadb"].includes(process.env.BAKORIN_TEST_DIALECT ?? "")
  ? (process.env.BAKORIN_TEST_DIALECT as "postgres" | "mysql" | "mariadb")
  : "sqlite";

const SQLITE_BLOCK = `  sqlite:\n    path: ./data/app.db\n`;

export async function boot(
  yaml?: string,
  hooks?: string,
  options: { workers?: boolean } = {},
): Promise<RuntimeHandles & { dir: string }> {
  const source = yaml ?? MINI_YAML;
  if (TEST_DIALECT !== "sqlite" && source.includes("dialect: sqlite") && source.includes(SQLITE_BLOCK)) {
    return TEST_DIALECT === "postgres" ? bootOnPostgres(source, hooks, options) : bootOnMysql(source, hooks, options);
  }
  return bootAs(source, hooks, options);
}

/** For tests about SQLite files themselves (snapshots, app.db downloads). */
export async function bootSqlite(yaml?: string, hooks?: string): Promise<RuntimeHandles & { dir: string }> {
  return bootAs(yaml ?? MINI_YAML, hooks);
}

async function bootAs(yaml: string, hooks?: string, options: { workers?: boolean } = {}): Promise<RuntimeHandles & { dir: string }> {
  const dir = await tempProject(yaml, hooks);
  const runtime = await createRuntime({
    projectDir: dir,
    yamlSource: await Bun.file(join(dir, "app.yaml")).text(),
    ...options,
  });
  return Object.assign(runtime, { dir });
}

export function postgresYaml(url: string, base = MINI_YAML): string {
  return base.replace("dialect: sqlite", "dialect: postgres").replace(
    `  sqlite:\n    path: ./data/app.db\n`,
    `  postgres:\n    url: "${url}"\n`,
  );
}

export async function bootPostgres(hooks?: string, base = MINI_YAML): Promise<RuntimeHandles & { dir: string; database: string }> {
  return bootOnPostgres(base, hooks);
}

async function bootOnPostgres(base: string, hooks?: string, options: { workers?: boolean } = {}): Promise<RuntimeHandles & { dir: string; database: string }> {
  const adminUrl = POSTGRES_URL;
  if (!adminUrl) {
    throw new Error("DATABASE_URL (postgres://) or POSTGRES_TEST_URL is required for postgres tests");
  }
  const { createPostgresDatabase, dropPostgresDatabase } = await import("@bakorin/server");
  const database = `b${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const url = await createPostgresDatabase(adminUrl, database);
  const runtime = await bootAs(postgresYaml(url, base), hooks, options);
  const originalClose = runtime.close.bind(runtime);
  runtime.close = async () => {
    await originalClose();
    await dropPostgresDatabase(adminUrl, database);
  };
  return Object.assign(runtime, { database });
}

export function client(runtime: RuntimeHandles & { dir?: string }, token?: string) {
  return {
    fetch(path: string, init: RequestInit = {}) {
      const headers = new Headers(init.headers);
      if (token) {
        headers.set("authorization", `Bearer ${token}`);
      }
      if (!headers.has("x-forwarded-for")) {
        headers.set("x-forwarded-for", runtime.dir ?? "test");
      }
      if (init.body && !headers.has("content-type") && typeof init.body === "string") {
        headers.set("content-type", "application/json");
      }
      return runtime.app.request(path, { ...init, headers });
    },
  };
}

/**
 * Account emails go through the mail outbox and are delivered in the background,
 * so tests wait for the log driver to record them.
 */
export async function waitForLoggedToken(
  purpose: "reset" | "verify" | "invite" | "existing",
  timeoutMs = 4000,
): Promise<string> {
  const { getLoggedMail } = await import("@bakorin/server");
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const token = getLoggedMail().filter((item) => item.meta?.purpose === purpose).at(-1)?.meta?.token;
    if (token) {
      return token;
    }
    await Bun.sleep(10);
  }
  throw new Error(`no ${purpose} mail`);
}

/**
 * Signup never returns a session (it answers the same way for new and existing
 * emails), so tests that need a signed in user sign up and then log in. Returns
 * the login response, or the signup response when signup did not answer 202.
 */
export async function signupAndLogin(
  api: { fetch(path: string, init?: RequestInit): Response | Promise<Response> },
  init: RequestInit,
): Promise<Response> {
  const signup = await api.fetch("/api/v1/auth/signup", { method: "POST", ...init });
  if (signup.status !== 202) {
    return signup;
  }
  const body = JSON.parse(String(init.body ?? "{}")) as Record<string, unknown>;
  return api.fetch("/api/v1/auth/login", {
    method: "POST",
    headers: init.headers,
    body: JSON.stringify({ email: body.email, password: body.password }),
  });
}

/** Same isolated database per test as Postgres, using mysql2 for MySQL or MariaDB. */
export async function bootMysql(hooks?: string, base = MINI_YAML): Promise<RuntimeHandles & { dir: string; database: string }> {
  return bootOnMysql(base, hooks);
}

export function mysqlYaml(url: string, base = MINI_YAML): string {
  return base.replace("dialect: sqlite", "dialect: mysql").replace(SQLITE_BLOCK, `  mysql:\n    url: "${url}"\n`);
}

async function bootOnMysql(base: string, hooks?: string, options: { workers?: boolean } = {}): Promise<RuntimeHandles & { dir: string; database: string }> {
  const adminUrl = MYSQL_URL;
  if (!adminUrl) {
    throw new Error("MYSQL_TEST_URL or DATABASE_URL (mysql:// or mariadb://) is required for mysql tests");
  }
  const { createMysqlDatabase, dropMysqlDatabase } = await import("@bakorin/server");
  const database = `b${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const url = await createMysqlDatabase(adminUrl, database);
  let runtime: Awaited<ReturnType<typeof bootAs>>;
  try {
    runtime = await bootAs(mysqlYaml(url, base), hooks, options);
  } catch (error) {
    await dropMysqlDatabase(adminUrl, database);
    throw error;
  }
  const originalClose = runtime.close.bind(runtime);
  runtime.close = async () => {
    await originalClose();
    await dropMysqlDatabase(adminUrl, database);
  };
  return Object.assign(runtime, { database });
}
