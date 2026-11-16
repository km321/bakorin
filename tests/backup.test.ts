import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { boot, bootSqlite, client, signupAndLogin } from "./helpers.ts";
import { exportPortable, importPortable, runBackup } from "@bakorin/server";
import { restoreSqliteSnapshot } from "../packages/server/src/backup/sqlite.ts";
import { compileAppYaml } from "@bakorin/core";
import { openSqlite, migrateToSchema } from "@bakorin/server";

describe("backup restore", () => {
  test("sqlite snapshot round trip", async () => {
    const runtime = await bootSqlite();
    const signup = await signupAndLogin(client(runtime), {
      method: "POST",
      body: JSON.stringify({ email: "dev@example.com", password: "password123", name: "Dev" }),
    });
    const token = (await signup.json()).data.accessToken as string;
    await client(runtime, token).fetch("/api/v1/items", { method: "POST", body: JSON.stringify({ title: "Keep me" }) });
    const dest = join(runtime.dir, "snap");
    await runtime.close();

    const ast = compileAppYaml(await Bun.file(join(runtime.dir, "app.yaml")).text(), {
      env: { JWT_SECRET: "test-jwt-secret-0123456789-abcdefghijklmnop" },
    });
    const { backupSqlite } = await import("../packages/server/src/backup/sqlite.ts");
    await backupSqlite({
      dbPath: join(runtime.dir, "data/app.db"),
      projectDir: runtime.dir,
      dest,
      ast,
      uploadsPath: join(runtime.dir, "data/uploads"),
    });

    const restoredDir = join(runtime.dir, "restored.db");
    await restoreSqliteSnapshot({ src: dest, dbPath: restoredDir, uploadsPath: join(runtime.dir, "uploads-restored") });
    const { db } = openSqlite(restoredDir);
    const rows = await db.selectFrom("items").selectAll().execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.title).toBe("Keep me");
    await db.destroy();
  });

  test("portable export import round trip", async () => {
    const runtime = await boot();
    const signup = await signupAndLogin(client(runtime), {
      method: "POST",
      body: JSON.stringify({ email: "dev@example.com", password: "password123", name: "Dev" }),
    });
    const token = (await signup.json()).data.accessToken as string;
    await client(runtime, token).fetch("/api/v1/items", { method: "POST", body: JSON.stringify({ title: "Portable" }) });
    const dest = join(runtime.dir, "export");
    await exportPortable({
      dest,
      projectDir: runtime.dir,
      ast: runtime.ast,
      db: runtime.db,
      files: runtime.context.files,
    });
    await runtime.db.deleteFrom("items").execute();
    expect((await runtime.db.selectFrom("items").selectAll().execute()).length).toBe(0);
    await importPortable({ src: dest, ast: runtime.ast, db: runtime.db, files: runtime.context.files });
    const rows = await runtime.db.selectFrom("items").selectAll().execute();
    expect(rows).toHaveLength(1);
    await runtime.close();
  });

  test("runBackup writes a directory", async () => {
    const runtime = await boot();
    const dest = await runBackup({
      ast: runtime.ast,
      db: runtime.db,
      files: runtime.context.files,
      projectDir: runtime.dir,
      destination: join(runtime.dir, "backups"),
    });
    expect(await Bun.file(join(dest, "manifest.json")).exists()).toBe(true);
    await runtime.close();
    void migrateToSchema;
  });
});
