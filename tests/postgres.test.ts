import { describe, expect, test } from "bun:test";
import { compileAppYaml } from "@bakorin/core";
import { migrateToSchema, openPostgres } from "@bakorin/server";
import { MINI_YAML } from "./helpers.ts";

const url = process.env.DATABASE_URL;

describe.skipIf(!url)("postgres", () => {
  test("migrator applies on postgres", async () => {
    const { db, pool } = openPostgres(url as string);
    const ast = compileAppYaml(
      MINI_YAML.replace("dialect: sqlite", "dialect: postgres").replace("path: ./data/app.db", "") +
        `\n  postgres:\n    url: ${url}\n`,
      { env: { JWT_SECRET: "test-secret-test-secret-test-secret-32", DATABASE_URL: url } },
    );
    ast.runtime.dialect = "postgres";
    ast.runtime.postgresUrl = url;
    await migrateToSchema(db, ast);
    await db.destroy();
    await pool.end();
    expect(true).toBe(true);
  });
});
