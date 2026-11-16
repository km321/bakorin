/** bakorin schema, typegen, and migrate. */

import { join, resolve } from "node:path";
import { buildSchemaGraph, compileAppYaml, DestructiveChangeError, formatPlan, generateTypes, schemaToJson, schemaToMermaid } from "@bakorin/core";
import { createFiles, migrationOptions, openDb } from "./app.ts";
import { applyProjectEnv } from "./env-files.ts";
import { migrateToSchema, planMigration } from "./db/migrator.ts";
import { arg, hasFlag, projectDir } from "./cli-args.ts";
import { loadOrExit, reportValidationError } from "./cli-serve.ts";

export async function cmdSchema(): Promise<void> {
  const dir = projectDir();
  await applyProjectEnv(dir);
  const yamlPath = join(dir, "app.yaml");
  if (!(await Bun.file(yamlPath).exists())) {
    console.error(`no app.yaml in ${dir}`);
    process.exit(1);
  }
  const format = (arg("--format", "mermaid") ?? "mermaid").toLowerCase();
  try {
    // Reads the schema only; no server starts, so the JWT secret is not needed.
    const ast = compileAppYaml(await Bun.file(yamlPath).text(), { production: false });
    const graph = buildSchemaGraph(ast);
    switch (format) {
      case "mermaid":
        process.stdout.write(schemaToMermaid(graph));
        break;
      case "json":
        process.stdout.write(schemaToJson(graph));
        break;
      default:
        console.error("usage: bakorin schema --format mermaid|json");
        process.exit(1);
    }
  } catch (error) {
    reportValidationError(error, "startup");
    process.exit(1);
  }
}

export async function cmdTypegen(): Promise<void> {
  const dir = projectDir();
  const runtime = await loadOrExit(dir);
  const out = resolve(arg("-o", arg("--out", join(dir, "bakorin.gen.ts"))) ?? join(dir, "bakorin.gen.ts"));
  await Bun.write(out, generateTypes(runtime.ast));
  console.log(`wrote ${out}`);
  await runtime.close();
}

/** Opens the project's database and schema without migrating, for planning. */
export async function openForPlan(dir: string) {
  await applyProjectEnv(dir);
  const yamlPath = join(dir, "app.yaml");
  if (!(await Bun.file(yamlPath).exists())) {
    console.error(`no app.yaml in ${dir}`);
    process.exit(1);
  }
  let ast;
  try {
    // Type generation reads the schema only; no server starts.
    ast = compileAppYaml(await Bun.file(yamlPath).text(), { env: process.env, production: false });
  } catch (error) {
    reportValidationError(error, "startup");
    process.exit(1);
  }
  const opened = openDb(ast, dir);
  return { ast, opened };
}

export async function cmdMigrate(): Promise<void> {
  const dir = projectDir();
  const { ast, opened } = await openForPlan(dir);
  const allow = arg("--allow-destructive");
  try {
    const planned = await planMigration(opened.db, ast);
    const { plan, confirmCode } = planned;
    if (hasFlag("--plan")) {
      console.log(`Migration plan for ${ast.appName} (${ast.runtime.dialect})`);
      console.log("");
      console.log(formatPlan(plan));
      if (plan.abort.length > 0) {
        console.log("");
        console.log("Blocked changes stop the server from starting. Change app.yaml so they are not needed.");
      }
      if (confirmCode) {
        console.log("");
        console.log(`Confirm code: ${confirmCode}`);
        console.log(`Apply with: bakorin migrate --allow-destructive ${confirmCode}`);
        console.log("A backup is taken automatically before anything is changed.");
      }
      return;
    }
    if (plan.abort.length > 0) {
      console.error(formatPlan(plan));
      console.error("");
      console.error("Nothing was changed. Change app.yaml so the blocked changes are not needed.");
      process.exitCode = 1;
      return;
    }
    const files = createFiles(ast, dir);
    const result = await migrateToSchema(
      opened.db,
      ast,
      migrationOptions(ast, opened.db, files, dir, process.env, allow ? { allowDestructive: allow } : {}),
    );
    const total = result.plan.auto.length + result.plan.safe.length + result.plan.deprecate.length;
    console.log(total === 0 ? "Schema is up to date." : `Applied ${total} change${total === 1 ? "" : "s"}.`);
    if (result.backup) {
      console.log(`Backup taken first: ${result.backup}`);
    }
  } catch (error) {
    if (error instanceof DestructiveChangeError) {
      console.error(error.message);
      process.exitCode = 2;
      return;
    }
    throw error;
  } finally {
    await opened.close();
  }
}
