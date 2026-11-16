import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createDownloadToken, readTar, verifyBackup } from "@bakorin/server";
import { boot, bootSqlite, client } from "./helpers.ts";
import { startS3Mock } from "./s3-mock.ts";

async function signInAdmin(runtime: Awaited<ReturnType<typeof boot>>, email: string) {
  const api = client(runtime);
  const signup = await api.fetch("/api/v1/auth/signup", {
    method: "POST",
    body: JSON.stringify({ email, password: "password123", name: "Admin" }),
  });
  expect(signup.status).toBe(201);
  const user = (await signup.json()).data.user as { id: string };
  await runtime.db.updateTable("users").set({ role: "admin" }).where("id", "=", user.id).execute();
  const login = await api.fetch("/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password: "password123" }),
  });
  expect(login.status).toBe(200);
  return client(runtime, (await login.json()).data.accessToken as string);
}

describe("admin backups", () => {
  test("rejects anonymous and non-admin callers", async () => {
    const runtime = await boot();
    const anon = await client(runtime).fetch("/api/v1/backups");
    expect(anon.status).toBe(401);
    const userSignup = await client(runtime).fetch("/api/v1/auth/signup", {
      method: "POST",
      body: JSON.stringify({ email: "user@example.com", password: "password123", name: "User" }),
    });
    const token = (await userSignup.json()).data.accessToken as string;
    const forbidden = await client(runtime, token).fetch("/api/v1/backups", { method: "POST" });
    expect(forbidden.status).toBe(403);
    await runtime.close();
  });

  test("admin can trigger a live backup and list timestamp plus size", async () => {
    const runtime = await boot();
    const admin = await signInAdmin(runtime, "ops@example.com");
    const empty = await admin.fetch("/api/v1/backups");
    expect(empty.status).toBe(200);
    expect((await empty.json()).data).toEqual([]);

    const created = await admin.fetch("/api/v1/backups", { method: "POST" });
    expect(created.status).toBe(201);
    const backup = (await created.json()).data as {
      id: string;
      createdAt: string;
      size: number;
      location: string;
      restoreCommand: string;
    };
    expect(backup.id).toMatch(/^\d{4}-/);
    expect(backup.size).toBeGreaterThan(0);
    expect(backup.location).toContain(backup.id);
    expect(backup.restoreCommand).toContain("bakorin restore");
    expect(backup.restoreCommand).not.toMatch(/s3:\/\//);

    const listed = await admin.fetch("/api/v1/backups");
    const rows = (await listed.json()).data as Array<{ id: string; size: number }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(backup.id);
    expect(rows[0]?.size).toBe(backup.size);
    await runtime.close();
  });

  test("admin backups to S3 list stamp and size, and download", async () => {
    const mock = startS3Mock();
    const yaml = `
app:
  name: mini
runtime:
  dialect: sqlite
  sqlite:
    path: ./data/app.db
  files:
    driver: s3
    bucket: ${mock.bucket}
    endpoint: ${mock.endpoint}
    accessKey: ${mock.accessKey}
    secretKey: ${mock.secretKey}
    region: us-east-1
    path: ./data/uploads
  jwt:
    secret: test-jwt-secret-0123456789-abcdefghijklmnop
  backups:
    retain: 5
    destination: s3://${mock.bucket}/backups
auth:
  entity: users
  signup: open
entities:
  users:
    auth: true
    fields:
      email: { type: email, unique: true, required: true }
      password: { type: password, required: true }
      name: { type: text, required: true }
      role: { type: enum, values: [user, admin], default: user }
`;
    const runtime = await boot(yaml);
    const admin = await signInAdmin(runtime, "ops@example.com");
    const created = await admin.fetch("/api/v1/backups", { method: "POST" });
    expect(created.status).toBe(201);
    const backup = (await created.json()).data as { id: string; size: number; location: string; restoreCommand: string };
    expect(backup.location).toStartWith("s3://");
    expect(backup.size).toBeGreaterThan(0);
    expect(backup.restoreCommand).toContain("download");
    const listed = await admin.fetch("/api/v1/backups");
    expect((await listed.json()).data).toHaveLength(1);
    const link = await admin.fetch(`/api/v1/backups/${backup.id}/link`, { method: "POST" });
    expect(link.status).toBe(200);
    const download = await client(runtime).fetch(((await link.json()).data as { url: string }).url);
    expect(download.status).toBe(200);
    const files = readTar(new Uint8Array(await download.arrayBuffer()));
    const out = await mkdtemp(join(tmpdir(), "bakorin-dl-"));
    for (const file of files) {
      await mkdir(dirname(join(out, file.path)), { recursive: true });
      await writeFile(join(out, file.path), file.bytes);
    }
    const verified = await verifyBackup(join(out, backup.id));
    expect(verified.errors).toEqual([]);
    expect(verified.ok).toBe(true);
    await runtime.close();
    mock.stop();
  }, 30_000);

  test("download: admin-only, short-lived, bound to one backup", async () => {
    const runtime = await bootSqlite();
    const admin = await signInAdmin(runtime, "ops@example.com");
    const created = (await (await admin.fetch("/api/v1/backups", { method: "POST" })).json()).data as { id: string };
    const second = (await (await admin.fetch("/api/v1/backups", { method: "POST" })).json()).data as { id: string };
    expect(second.id).not.toBe(created.id);

    expect((await client(runtime).fetch(`/api/v1/backups/${created.id}/link`, { method: "POST" })).status).toBe(401);
    expect((await client(runtime).fetch(`/api/v1/backups/${created.id}/download`)).status).toBe(403);
    const userSignup = await client(runtime).fetch("/api/v1/auth/signup", {
      method: "POST",
      body: JSON.stringify({ email: "user@example.com", password: "password123", name: "User" }),
    });
    const user = (await userSignup.json()).data as { accessToken: string; user: { id: string } };
    expect((await client(runtime, user.accessToken).fetch(`/api/v1/backups/${created.id}/link`, { method: "POST" })).status).toBe(403);
    expect((await client(runtime, user.accessToken).fetch(`/api/v1/backups/${created.id}/download`)).status).toBe(403);

    const link = await admin.fetch(`/api/v1/backups/${created.id}/link`, { method: "POST" });
    const { url, expiresAt } = (await link.json()).data as { url: string; expiresAt: string };
    expect(Date.parse(expiresAt) - Date.now()).toBeLessThanOrEqual(60_000);
    const response = await client(runtime).fetch(url);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/gzip");
    expect(response.headers.get("content-disposition")).toBe(
      `attachment; filename="mini-backup-${created.id.replaceAll(".", "-")}.tar.gz"`,
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    const paths = readTar(new Uint8Array(await response.arrayBuffer())).map((file) => file.path);
    expect(paths).toContain(`${created.id}/manifest.json`);
    expect(paths).toContain(`${created.id}/app.db`);
    expect(paths).toContain(`${created.id}/portable/data/users.ndjson`);

    const token = new URL(url, "http://x").searchParams.get("token")!;
    expect((await client(runtime).fetch(`/api/v1/backups/${second.id}/download?token=${encodeURIComponent(token)}`)).status).toBe(403);
    const adminRow = (await runtime.db.selectFrom("users").select("id").where("role", "=", "admin").executeTakeFirstOrThrow()) as { id: string };
    const expired = createDownloadToken(runtime.ast.runtime.jwtSecret, created.id, adminRow.id, Date.now() - 120_000);
    expect((await client(runtime).fetch(`/api/v1/backups/${created.id}/download?token=${encodeURIComponent(expired)}`)).status).toBe(403);
    const forged = createDownloadToken("some-other-secret-some-other-secret-32", created.id, adminRow.id);
    expect((await client(runtime).fetch(`/api/v1/backups/${created.id}/download?token=${encodeURIComponent(forged)}`)).status).toBe(403);

    // A link stops working once its admin is demoted.
    const fresh = (await (await admin.fetch(`/api/v1/backups/${created.id}/link`, { method: "POST" })).json()).data as { url: string };
    await runtime.db.updateTable("users").set({ role: "user" }).where("id", "=", adminRow.id).execute();
    expect((await client(runtime).fetch(fresh.url)).status).toBe(403);
    await runtime.db.updateTable("users").set({ role: "admin" }).where("id", "=", adminRow.id).execute();

    expect((await admin.fetch("/api/v1/backups/..%2F..%2Fetc/link", { method: "POST" })).status).toBe(404);
    expect((await admin.fetch("/api/v1/backups/2020-01-01T00-00-00.000Z/link", { method: "POST" })).status).toBe(404);
    // Bearer admin works directly, for curl.
    expect((await admin.fetch(`/api/v1/backups/${created.id}/download`)).status).toBe(200);
    await runtime.close();
  });
});
