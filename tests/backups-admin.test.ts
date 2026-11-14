import { describe, expect, test } from "bun:test";
import { boot, client } from "./helpers.ts";
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

  test("admin backups to S3 list stamp and size", async () => {
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
    secret: test-secret-test-secret-test-secret-32
  backups:
    retain: 5
    destination: s3://${mock.bucket}/backups
auth:
  entity: users
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
    expect(backup.restoreCommand).toContain("copy");
    const listed = await admin.fetch("/api/v1/backups");
    expect((await listed.json()).data).toHaveLength(1);
    await runtime.close();
    mock.stop();
  });
});
