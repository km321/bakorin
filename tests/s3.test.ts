import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { createS3FileStore, pruneS3Backups } from "@bakorin/server";
import { boot, client, signupAndLogin } from "./helpers.ts";
import { startS3Mock } from "./s3-mock.ts";
import { runBackup } from "@bakorin/server";

describe("s3 file store and backup retention", () => {
  test("lists, copies, and deletes objects through the S3 client", async () => {
    const mock = startS3Mock();
    const store = createS3FileStore({
      bucket: mock.bucket,
      accessKey: mock.accessKey,
      secretKey: mock.secretKey,
      endpoint: mock.endpoint,
      region: "us-east-1",
    });
    await store.put("docs/a.txt", new TextEncoder().encode("alpha"), "text/plain");
    await store.put("docs/b.txt", new TextEncoder().encode("beta"), "text/plain");
    await store.put("other/c.txt", new TextEncoder().encode("gamma"), "text/plain");
    const listed = (await store.list("docs/")).sort();
    expect(listed).toEqual(["docs/a.txt", "docs/b.txt"]);
    const got = await store.get("docs/a.txt");
    expect(got ? new TextDecoder().decode(got.bytes) : "").toBe("alpha");
    await store.delete("docs/a.txt");
    expect(await store.list("docs/")).toEqual(["docs/b.txt"]);
    mock.stop();
  });

  test("scheduled backup retain drops older S3 prefixes", async () => {
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
    retain: 2
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
    const signup = await signupAndLogin(client(runtime), {
      method: "POST",
      body: JSON.stringify({ email: "dev@example.com", password: "password123", name: "Dev" }),
    });
    expect(signup.status).toBe(200);
    await runBackup({ ast: runtime.ast, db: runtime.db, files: runtime.context.files, projectDir: runtime.dir });
    await Bun.sleep(20);
    await runBackup({ ast: runtime.ast, db: runtime.db, files: runtime.context.files, projectDir: runtime.dir });
    await Bun.sleep(20);
    await runBackup({ ast: runtime.ast, db: runtime.db, files: runtime.context.files, projectDir: runtime.dir });
    const store = createS3FileStore({
      bucket: mock.bucket,
      accessKey: mock.accessKey,
      secretKey: mock.secretKey,
      endpoint: mock.endpoint,
      region: "us-east-1",
    });
    await pruneS3Backups(store, "backups", 2);
    const keys = await store.list("backups/");
    const stamps = new Set(keys.map((key) => key.split("/")[1]));
    expect(stamps.size).toBe(2);
    await runtime.close();
    mock.stop();
    void join;
  });
});
