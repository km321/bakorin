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
  test("a backup in the files bucket does not copy older backups", async () => {
    const mock = startS3Mock();
    const s3 = `
    driver: s3
    bucket: ${mock.bucket}
    endpoint: ${mock.endpoint}
    accessKey: ${mock.accessKey}
    secretKey: ${mock.secretKey}
    region: us-east-1
    path: ./data/uploads`;
    const yaml = `
app:
  name: mini
runtime:
  dialect: sqlite
  sqlite:
    path: ./data/app.db
  files:${s3}
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
    const files = runtime.context.files;
    await files.put("upload-1.txt", new TextEncoder().encode("kept"), "text/plain");
    await files.put("backupsish/keep.txt", new TextEncoder().encode("kept too"), "text/plain");
    for (let i = 0; i < 3; i++) {
      await runBackup({ ast: runtime.ast, db: runtime.db, files, projectDir: runtime.dir });
      await Bun.sleep(20);
    }
    const keys = await files.list("backups/");
    const stamps = [...new Set(keys.map((key) => key.split("/")[1]))].sort();
    expect(stamps.length).toBe(3);
    const last = keys.filter((key) => key.startsWith(`backups/${stamps.at(-1)}/`));
    // SQLite backups hold the portable export under portable/; Postgres backups are the export.
    const filesRoot = `backups/${stamps.at(-1)}/${last.some((key) => key.includes("/portable/")) ? "portable/" : ""}files/`;
    expect(last.some((key) => key.startsWith(`${filesRoot}backups/`))).toBe(false);
    expect(last).toContain(`${filesRoot}upload-1.txt`);
    expect(last).toContain(`${filesRoot}backupsish/keep.txt`);
    // The newest backup is no bigger than the first: no nesting.
    const count = (stamp: string) => keys.filter((key) => key.startsWith(`backups/${stamp}/`)).length;
    expect(count(stamps.at(-1)!)).toBe(count(stamps[0]!));
    await runtime.close();
    mock.stop();
  });
});
