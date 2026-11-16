import { describe, expect, test } from "bun:test";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  compileAppYaml,
  DestructiveChangeError,
  destructiveCode,
  diffSchemas,
  formatPlan,
} from "@bakorin/core";
import { createRuntime, migrateToSchema, openSqlite, planMigration } from "@bakorin/server";
import { MINI_YAML, tempProject } from "./helpers.ts";

const ENV = { env: { JWT_SECRET: "test-jwt-secret-0123456789-abcdefghijklmnop" } };
const CLI = join(import.meta.dir, "../packages/server/src/cli.ts");
const WITHOUT_DONE = MINI_YAML.replace("      done: { type: boolean, default: false }\n", "");

async function start(dir: string, env: Record<string, string | undefined> = {}) {
  return createRuntime({
    projectDir: dir,
    yamlSource: await Bun.file(join(dir, "app.yaml")).text(),
    env: { ...ENV.env, ...env },
    workers: false,
  });
}

async function seededProject(): Promise<string> {
  const dir = await tempProject();
  const runtime = await start(dir);
  await runtime.db
    .insertInto("users")
    .values({
      id: "u1",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      email: "a@example.com",
      password: "x",
      name: "A",
      role: "user",
    })
    .execute();
  await runtime.db
    .insertInto("items")
    .values({
      id: "i1",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      title: "Keep me",
      done: 1,
      ownerId: "u1",
    })
    .execute();
  await runtime.close();
  return dir;
}

async function backupReasons(dir: string): Promise<string[]> {
  const root = join(dir, "data/backups");
  let names: string[] = [];
  try {
    names = await readdir(root);
  } catch {
    return [];
  }
  const reasons: string[] = [];
  for (const name of names.sort()) {
    const manifest = JSON.parse(await readFile(join(root, name, "manifest.json"), "utf8")) as { reason?: string };
    reasons.push(manifest.reason ?? "");
  }
  return reasons;
}

async function cli(dir: string, ...args: string[]) {
  const proc = Bun.spawn(["bun", CLI, ...args, "--dir", dir], { cwd: dir, stdout: "pipe", stderr: "pipe" });
  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  return { code: await proc.exited, out: `${out}${err}` };
}

describe("schema changes: plan", () => {
  test("removals are confirmation-gated with a stable code", () => {
    const plan = diffSchemas(compileAppYaml(MINI_YAML, ENV), compileAppYaml(WITHOUT_DONE, ENV));
    expect(plan.deprecate).toEqual([{ tier: "deprecate", kind: "drop_field", entity: "items", field: "done" }]);
    expect(destructiveCode(plan)).toMatch(/^[0-9a-f]{8}$/);
    expect(destructiveCode(plan)).toBe(destructiveCode(diffSchemas(compileAppYaml(MINI_YAML, ENV), compileAppYaml(WITHOUT_DONE, ENV))));
    expect(formatPlan(plan)).toContain("Removals, need confirmation:");
  });

  test("enum value removal needs confirmation instead of aborting", () => {
    const plan = diffSchemas(
      compileAppYaml(MINI_YAML, ENV),
      compileAppYaml(MINI_YAML.replace("values: [user, admin]", "values: [admin]"), ENV),
    );
    expect(plan.abort).toEqual([]);
    expect(plan.deprecate).toEqual([
      { tier: "deprecate", kind: "remove_enum_values", entity: "users", field: "role", values: ["user"] },
    ]);
  });

  test("a drop next to an add of the same entity gets a renameFrom hint", () => {
    const plan = diffSchemas(
      compileAppYaml(MINI_YAML, ENV),
      compileAppYaml(MINI_YAML.replace("done: { type: boolean, default: false }", "complete: { type: boolean, default: false }"), ENV),
    );
    const drop = plan.deprecate[0] as { hint?: string };
    expect(drop.hint).toContain("renameFrom: done");
  });

  test("narrowing a type stays blocked with guidance", () => {
    const plan = diffSchemas(
      compileAppYaml(MINI_YAML, ENV),
      compileAppYaml(MINI_YAML.replace("title: { type: text, required: true }", "title: { type: integer, required: true }"), ENV),
    );
    expect(plan.abort.length).toBe(1);
    expect(formatPlan(plan)).toContain("Add a new field, copy the data");
  });

  test("renamedFrom gets a did-you-mean", () => {
    expect(() => compileAppYaml(MINI_YAML.replace("  items:\n    fields:", "  items:\n    renamedFrom: todos\n    fields:"), ENV)).toThrow(
      /Did you mean renameFrom/,
    );
  });
});

describe("schema changes: applying", () => {
  test("additive changes apply on boot without a backup", async () => {
    const dir = await seededProject();
    await writeFile(join(dir, "app.yaml"), MINI_YAML.replace("done: { type: boolean, default: false }", "done: { type: boolean, default: false }\n      notes: { type: text }"));
    const runtime = await start(dir);
    expect(runtime.ast.entityMap.items?.fieldMap.notes).toBeTruthy();
    await runtime.close();
    expect(await backupReasons(dir)).toEqual([]);
  });

  test("boot refuses a removal, changes nothing, and explains how to confirm", async () => {
    const dir = await seededProject();
    await writeFile(join(dir, "app.yaml"), WITHOUT_DONE);
    let caught: unknown;
    try {
      await start(dir);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(DestructiveChangeError);
    const message = (caught as Error).message;
    expect(message).toContain("remove field items.done");
    expect(message).toContain("bakorin migrate --plan");
    expect(message).toContain(`BAKORIN_ALLOW_DESTRUCTIVE=${(caught as DestructiveChangeError).confirmCode}`);
    expect(await backupReasons(dir)).toEqual([]);
    const { db } = openSqlite(join(dir, "data/app.db"));
    const planned = await planMigration(db, compileAppYaml(WITHOUT_DONE, ENV));
    expect(planned.previous?.entityMap.items?.fieldMap.done).toBeTruthy();
    await db.destroy();
  });

  test("a wrong code is refused; the right code backs up first and applies", async () => {
    const dir = await seededProject();
    await writeFile(join(dir, "app.yaml"), WITHOUT_DONE);
    await expect(start(dir, { BAKORIN_ALLOW_DESTRUCTIVE: "00000000" })).rejects.toBeInstanceOf(DestructiveChangeError);
    const code = destructiveCode(diffSchemas(compileAppYaml(MINI_YAML, ENV), compileAppYaml(WITHOUT_DONE, ENV)));
    const runtime = await start(dir, { BAKORIN_ALLOW_DESTRUCTIVE: code });
    expect(runtime.ast.entityMap.items?.fieldMap.done).toBeUndefined();
    const row = await runtime.db.selectFrom("items").selectAll().where("id", "=", "i1").executeTakeFirstOrThrow();
    // Soft drop: the column and its data stay in the table.
    expect((row as Record<string, unknown>).done).toBe(1);
    await runtime.close();
    expect(await backupReasons(dir)).toEqual(["pre-migration"]);
  });

  test("a removed field added back comes back with its data", async () => {
    const dir = await seededProject();
    await writeFile(join(dir, "app.yaml"), WITHOUT_DONE);
    const removed = await start(dir, { BAKORIN_ALLOW_DESTRUCTIVE: destructiveCode(diffSchemas(compileAppYaml(MINI_YAML, ENV), compileAppYaml(WITHOUT_DONE, ENV))) });
    expect((await removed.db.selectFrom("_bakorin_deprecated").selectAll().execute()).length).toBe(1);
    await removed.close();
    await writeFile(join(dir, "app.yaml"), MINI_YAML);
    const back = await start(dir);
    const row = await back.db.selectFrom("items").select("done").where("id", "=", "i1").executeTakeFirstOrThrow();
    expect(row.done).toBe(1);
    expect(await back.db.selectFrom("_bakorin_deprecated").selectAll().execute()).toEqual([]);
    await back.close();
  });

  test("entity renameFrom renames the table and keeps rows, after a backup", async () => {
    const dir = await seededProject();
    const renamed = MINI_YAML.replace("  items:\n    fields:", "  tasks:\n    renameFrom: items\n    fields:");
    await writeFile(join(dir, "app.yaml"), renamed);
    const runtime = await start(dir);
    const rows = await runtime.db.selectFrom("tasks").select(["id", "title"]).execute();
    expect(rows).toEqual([{ id: "i1", title: "Keep me" }]);
    await runtime.close();
    expect(await backupReasons(dir)).toEqual(["pre-migration"]);
    // Keeping renameFrom in app.yaml afterwards is harmless.
    const again = await start(dir);
    expect(await again.db.selectFrom("tasks").select("id").execute()).toEqual([{ id: "i1" }]);
    await again.close();
    expect(await backupReasons(dir)).toEqual(["pre-migration"]);
  });

  test("field renameFrom keeps the data", async () => {
    const dir = await seededProject();
    await writeFile(join(dir, "app.yaml"), MINI_YAML.replace("title: { type: text, required: true }", "headline: { type: text, required: true, renameFrom: title }"));
    const runtime = await start(dir);
    const row = await runtime.db.selectFrom("items").select("headline").executeTakeFirstOrThrow();
    expect(row.headline).toBe("Keep me");
    await runtime.close();
  });

  test("dev reload with a removal keeps the old schema", async () => {
    const dir = await seededProject();
    const runtime = await start(dir);
    await expect(runtime.reload(WITHOUT_DONE)).rejects.toBeInstanceOf(DestructiveChangeError);
    expect(runtime.ast.entityMap.items?.fieldMap.done).toBeTruthy();
    await runtime.close();
  });

  test("migrateToSchema accepts allowDestructive for programmatic use", async () => {
    const dir = await seededProject();
    const { db } = openSqlite(join(dir, "data/app.db"));
    await expect(migrateToSchema(db, compileAppYaml(WITHOUT_DONE, ENV))).rejects.toBeInstanceOf(DestructiveChangeError);
    const result = await migrateToSchema(db, compileAppYaml(WITHOUT_DONE, ENV), { allowDestructive: true });
    expect(result.applied).toBe(true);
    await db.destroy();
  });
});

describe("schema changes: CLI", () => {
  test("migrate --plan, blocked migrate, confirmed migrate", async () => {
    const dir = await seededProject();
    await writeFile(join(dir, "app.yaml"), WITHOUT_DONE.replace("title: { type: text, required: true }", "title: { type: text, required: true }\n      notes: { type: text }"));
    const plan = await cli(dir, "migrate", "--plan");
    expect(plan.code).toBe(0);
    expect(plan.out).toContain("add field items.notes (text)");
    expect(plan.out).toContain("remove field items.done");
    const code = /Confirm code: ([0-9a-f]{8})/.exec(plan.out)?.[1];
    expect(code).toBeTruthy();
    const blocked = await cli(dir, "migrate");
    expect(blocked.code).toBe(2);
    expect(blocked.out).toContain(`bakorin migrate --allow-destructive ${code}`);
    expect(await backupReasons(dir)).toEqual([]);
    const applied = await cli(dir, "migrate", "--allow-destructive", code!);
    expect(applied.code).toBe(0);
    expect(applied.out).toContain("Backup taken first");
    expect(await backupReasons(dir)).toEqual(["pre-migration"]);
    const after = await cli(dir, "migrate", "--plan");
    expect(after.out).toContain("No schema changes.");
  }, 30_000);
});
