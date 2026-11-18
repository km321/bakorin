import { describe, expect, test } from "bun:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createRuntime, runBackup, verifyBackup, type RuntimeHandles } from "@bakorin/server";
import {
  AUDIT_TABLE,
  FILES_TABLE,
  MAIL_OUTBOX_TABLE,
  WEBHOOK_OUTBOX_TABLE,
} from "../packages/server/src/db/system.ts";
import { client, MINI_YAML, MYSQL_URL, mysqlYaml, POSTGRES_URL, postgresYaml, tempProject } from "./helpers.ts";

const CLI = join(import.meta.dir, "../packages/server/src/cli.ts");
const LOGO = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#0f766e"/></svg>';
const PASSWORD = "password123";

function withBranding(yaml: string): string {
  return yaml.replace("\nruntime:", '\nbranding:\n  name: Northwind Studio\n  primaryColor: "#0f766e"\n  logo: branding/logo.svg\nruntime:');
}

async function start(dir: string): Promise<RuntimeHandles> {
  return createRuntime({ projectDir: dir, yamlSource: await Bun.file(join(dir, "app.yaml")).text(), workers: false });
}

async function cli(dir: string, ...args: string[]): Promise<{ code: number; out: string }> {
  const proc = Bun.spawn(["bun", CLI, ...args, "--dir", dir], {
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, NODE_ENV: "test" },
  });
  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  return { code: await proc.exited, out: `${out}${err}` };
}

interface Seeded {
  adminId: string;
  itemTitles: string[];
  fileId: string;
}

async function seed(runtime: RuntimeHandles): Promise<Seeded> {
  const http = client(runtime);
  const first = await http.fetch("/api/v1/auth/first-admin", {
    method: "POST",
    body: JSON.stringify({ email: "ada@studio.test", password: PASSWORD, name: "Ada" }),
  });
  expect(first.status).toBe(201);
  const admin = ((await first.json()) as { data: { accessToken: string; user: { id: string } } }).data;
  const api = client(runtime, admin.accessToken);
  const itemTitles = ["Northwind", "Contoso", "Fabrikam"];
  for (const title of itemTitles) {
    expect((await api.fetch("/api/v1/items", { method: "POST", body: JSON.stringify({ title }) })).status).toBe(201);
  }
  const form = new FormData();
  form.set("file", new File(["hello restore"], "note.txt", { type: "text/plain" }));
  const uploaded = await api.fetch("/api/v1/files", { method: "POST", body: form });
  expect(uploaded.status).toBe(201);
  const fileId = ((await uploaded.json()) as { data: { id: string } }).data.id;
  const now = new Date().toISOString();
  await runtime.db
    .insertInto(MAIL_OUTBOX_TABLE)
    .values({
      id: "mail-1",
      idempotency_key: "restore-test",
      source: "test",
      to_addrs: '["ada@studio.test"]',
      cc_addrs: "[]",
      bcc_addrs: "[]",
      subject: "Queued before backup",
      html: "<p>hi</p>",
      body_text: "hi",
      attempts: 2,
      max_attempts: 5,
      status: "failed",
      last_error: "smtp down",
      next_attempt_at: now,
      created_at: now,
    })
    .execute();
  await runtime.db
    .insertInto(WEBHOOK_OUTBOX_TABLE)
    .values({
      id: "hook-1",
      url: "https://example.com/hook",
      payload: "{}",
      headers: "{}",
      attempts: 1,
      status: "pending",
      next_attempt_at: now,
      created_at: now,
    })
    .execute();
  return { adminId: admin.user.id, itemTitles, fileId };
}

async function wipe(runtime: RuntimeHandles, dir: string): Promise<void> {
  await runtime.db.deleteFrom("items").execute();
  await runtime.db.deleteFrom("users").execute();
  for (const table of [FILES_TABLE, MAIL_OUTBOX_TABLE, WEBHOOK_OUTBOX_TABLE]) {
    await runtime.db.deleteFrom(table).execute();
  }
  // Replace the logo instead of deleting it so the project still boots for the dry-run check.
  await writeFile(join(dir, "branding/logo.svg"), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  await rm(join(dir, "data/uploads"), { recursive: true, force: true });
}

async function expectRestored(runtime: RuntimeHandles, dir: string, seeded: Seeded): Promise<void> {
  const login = await client(runtime).fetch("/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "ada@studio.test", password: PASSWORD }),
  });
  expect(login.status).toBe(200);
  const token = ((await login.json()) as { data: { accessToken: string } }).data.accessToken;
  const api = client(runtime, token);
  const items = (await (await api.fetch("/api/v1/items?limit=50")).json()) as { data: Array<{ title: string }> };
  expect(items.data.map((item) => item.title).sort()).toEqual([...seeded.itemTitles].sort());
  const users = await runtime.db.selectFrom("users").select(["id", "role"]).execute();
  expect(users).toEqual([{ id: seeded.adminId, role: "admin" }]);
  const fileRow = await runtime.db.selectFrom(FILES_TABLE).selectAll().where("id", "=", seeded.fileId).executeTakeFirst();
  expect(fileRow).toBeTruthy();
  const keys = await runtime.context.files.list();
  expect(keys.length).toBe(1);
  const stored = await runtime.context.files.get(keys[0]!);
  expect(new TextDecoder().decode(stored!.bytes)).toBe("hello restore");
  const mail = await runtime.db.selectFrom(MAIL_OUTBOX_TABLE).selectAll().execute();
  expect(mail.map((row) => [row.id, row.status, row.subject])).toEqual([["mail-1", "failed", "Queued before backup"]]);
  const hooks = await runtime.db.selectFrom(WEBHOOK_OUTBOX_TABLE).select(["id", "status"]).execute();
  expect(hooks).toEqual([{ id: "hook-1", status: "pending" }]);
  expect(await readFile(join(dir, "branding/logo.svg"), "utf8")).toBe(LOGO);
  const audit = await runtime.db.selectFrom(AUDIT_TABLE).select("action").execute();
  expect(audit.length).toBeGreaterThan(0);
}

async function project(yaml: string): Promise<string> {
  const dir = await tempProject(withBranding(yaml));
  await mkdir(join(dir, "branding"), { recursive: true });
  await writeFile(join(dir, "branding/logo.svg"), LOGO);
  return dir;
}

async function roundTrip(yaml: string, options: { viaDownload: boolean }): Promise<void> {
  const dir = await project(yaml);
  let runtime = await start(dir);
  const seeded = await seed(runtime);
  const location = await runBackup({
    ast: runtime.ast,
    db: runtime.db,
    files: runtime.context.files,
    projectDir: dir,
    reason: "manual",
  });
  const verified = await verifyBackup(location);
  expect(verified.errors).toEqual([]);
  expect(verified.ok).toBe(true);
  expect(verified.checkedFiles).toBeGreaterThan(3);
  expect(verified.counts.items).toBe(3);
  expect(verified.counts.users).toBe(1);

  let source = location;
  if (options.viaDownload) {
    const login = await client(runtime).fetch("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "ada@studio.test", password: PASSWORD }),
    });
    const token = ((await login.json()) as { data: { accessToken: string } }).data.accessToken;
    const id = location.split("/").pop()!;
    const link = await client(runtime, token).fetch(`/api/v1/backups/${id}/link`, { method: "POST" });
    expect(link.status).toBe(200);
    const url = ((await link.json()) as { data: { url: string } }).data.url;
    const download = await client(runtime).fetch(url);
    expect(download.status).toBe(200);
    expect(download.headers.get("content-disposition")).toContain(".tar.gz");
    source = join(dir, "downloaded.tar.gz");
    await Bun.write(source, new Uint8Array(await download.arrayBuffer()));
  }

  await wipe(runtime, dir);
  await runtime.close();

  const dry = await cli(dir, "restore", source, "--dry-run");
  expect(dry.code).toBe(0);
  expect(dry.out).toContain("Dry run");
  expect(dry.out).toContain("Nothing was changed.");
  runtime = await start(dir);
  expect(await runtime.db.selectFrom("items").selectAll().execute()).toEqual([]);
  await runtime.close();

  const restored = await cli(dir, "restore", source);
  expect(restored.code).toBe(0);
  expect(restored.out).toContain("current data backed up first");
  runtime = await start(dir);
  await expectRestored(runtime, dir, seeded);
  await runtime.close();
}

describe("restore: sqlite", () => {
  test("backup, wipe, restore from the folder brings everything back", async () => {
    await roundTrip(MINI_YAML, { viaDownload: false });
  }, 60_000);

  test("restore from a downloaded .tar.gz", async () => {
    await roundTrip(MINI_YAML, { viaDownload: true });
  }, 60_000);

  test("a tampered backup is refused and nothing changes", async () => {
    const dir = await project(MINI_YAML);
    const runtime = await start(dir);
    await seed(runtime);
    const location = await runBackup({ ast: runtime.ast, db: runtime.db, files: runtime.context.files, projectDir: dir });
    await runtime.db.deleteFrom("items").execute();
    await runtime.close();
    await writeFile(join(location, "portable/data/items.ndjson"), '{"id":"forged","title":"Forged"}\n');
    const verified = await verifyBackup(location);
    expect(verified.ok).toBe(false);
    expect(verified.errors.join("\n")).toContain("portable/data/items.ndjson");
    const result = await cli(dir, "restore", location);
    expect(result.code).toBe(1);
    expect(result.out).toContain("failed verification");
    const after = await start(dir);
    expect(await after.db.selectFrom("items").selectAll().execute()).toEqual([]);
    await after.close();
  }, 60_000);
});

const url = POSTGRES_URL;

describe.skipIf(!url)("restore: postgres", () => {
  test("backup, wipe, restore brings everything back", async () => {
    const { createPostgresDatabase, dropPostgresDatabase } = await import("@bakorin/server");
    const database = `r${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
    const dbUrl = await createPostgresDatabase(url!, database);
    try {
      await roundTrip(postgresYaml(dbUrl), { viaDownload: true });
    } finally {
      await dropPostgresDatabase(url!, database);
    }
  }, 90_000);
});

describe.skipIf(!MYSQL_URL)("restore: mysql and mariadb", () => {
  test("backup, wipe, restore brings everything back", async () => {
    const { createMysqlDatabase, dropMysqlDatabase } = await import("@bakorin/server");
    const database = `r${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
    const dbUrl = await createMysqlDatabase(MYSQL_URL!, database);
    try {
      await roundTrip(mysqlYaml(dbUrl), { viaDownload: true });
    } finally {
      await dropMysqlDatabase(MYSQL_URL!, database);
    }
  }, 90_000);
});
