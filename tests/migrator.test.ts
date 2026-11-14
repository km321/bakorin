import { describe, expect, test } from "bun:test";
import { compileAppYaml } from "@bakorin/core";
import { migrateToSchema, openSqlite } from "@bakorin/server";
import { join } from "node:path";
import { tempProject, MINI_YAML } from "./helpers.ts";

describe("migrator", () => {
  test("creates tables from an empty database", async () => {
    const dir = await tempProject();
    const { db } = openSqlite(join(dir, "data/app.db"));
    const ast = compileAppYaml(MINI_YAML, { env: { JWT_SECRET: "test-secret-test-secret-test-secret-32" } });
    const result = await migrateToSchema(db, ast);
    expect(result.applied).toBe(true);
    const tables = await db.selectFrom("_bakorin_meta").selectAll().execute();
    expect(tables.length).toBeGreaterThan(0);
    await db.insertInto("users").values({
      id: "u1",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      email: "a@example.com",
      password: "x",
      name: "A",
      role: "user",
    }).execute();
    const to = compileAppYaml(
      MINI_YAML.replace(
        "done: { type: boolean, default: false }",
        "done: { type: boolean, default: false }\n      notes: { type: text }",
      ),
      { env: { JWT_SECRET: "test-secret-test-secret-test-secret-32" } },
    );
    const again = await migrateToSchema(db, to);
    expect(again.plan.auto.some((change) => change.kind === "add_field")).toBe(true);
    await db.destroy();
  });
});
