/**
 * Writes packages/create-bakorin/templates/gen/<schema>.gen.ts from each starter
 * schema, the same output as `bakorin typegen`. create-bakorin copies the matching
 * file into the web app, so every template starts with types for its own schema.
 *
 *   bun scripts/template-types.ts          write the files
 *   bun scripts/template-types.ts --check  exit 1 when a file is out of date
 */
import { compileAppYaml, generateTypes } from "@bakorin/core";
import { join, resolve } from "node:path";

const TEMPLATES = resolve(import.meta.dir, "../packages/create-bakorin/templates");
export const SCHEMAS = ["blank", "auth", "todo", "blog", "marketing", "saas", "store"] as const;

export async function templateTypes(schema: string): Promise<string> {
  const yaml = (await Bun.file(join(TEMPLATES, "schemas", `${schema}.yaml`)).text()).replaceAll("{{APP_NAME}}", "app");
  const ast = compileAppYaml(yaml, { env: {}, production: false });
  return generateTypes(ast);
}

if (import.meta.main) {
  const check = process.argv.includes("--check");
  let stale = 0;
  for (const schema of SCHEMAS) {
    const path = join(TEMPLATES, "gen", `${schema}.gen.ts`);
    const next = await templateTypes(schema);
    const file = Bun.file(path);
    const current = (await file.exists()) ? await file.text() : "";
    if (current === next) continue;
    if (check) {
      console.error(`out of date: ${path}`);
      stale++;
    } else {
      await Bun.write(path, next);
      console.log(`wrote ${path}`);
    }
  }
  process.exit(stale ? 1 : 0);
}
