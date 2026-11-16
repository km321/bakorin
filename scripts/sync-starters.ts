// Rebuilds examples/astro-starter and examples/next-starter from the create-bakorin
// templates (base frontend, todo overlay, todo types), so they never drift.
//   bun scripts/sync-starters.ts          write the examples
//   bun scripts/sync-starters.ts --check  fail when an example differs
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { writeFrontend } from "../packages/create-bakorin/src/cli.ts";

const ROOT = resolve(import.meta.dir, "..");
const SKIP = new Set(["node_modules", ".astro", ".next", "dist", "bun.lock", "package-lock.json", "next-env.d.ts", "README.md"]);

async function files(dir: string, base = dir): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (SKIP.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await files(path, base)));
    else out.push(relative(base, path));
  }
  return out.sort();
}

export async function starterDrift(frontend: "astro" | "next"): Promise<string[]> {
  const temp = await mkdtemp(join(tmpdir(), "bakorin-starter-"));
  try {
    await writeFrontend(frontend, "todo", temp);
    const example = join(ROOT, "examples", `${frontend}-starter`);
    const [want, have] = await Promise.all([files(temp), files(example)]);
    const problems: string[] = [];
    for (const file of new Set([...want, ...have])) {
      const a = await readFile(join(temp, file), "utf8").catch(() => null);
      const b = await readFile(join(example, file), "utf8").catch(() => null);
      if (a !== b) problems.push(`${frontend}-starter/${file}: ${a === null ? "not in the templates" : b === null ? "missing" : "differs"}`);
    }
    return problems;
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

async function write(frontend: "astro" | "next"): Promise<void> {
  const example = join(ROOT, "examples", `${frontend}-starter`);
  // Remove tracked source files that the templates no longer have, keep installs and the README.
  const temp = await mkdtemp(join(tmpdir(), "bakorin-starter-"));
  await writeFrontend(frontend, "todo", temp);
  const want = new Set(await files(temp));
  for (const file of await files(example)) {
    if (!want.has(file)) await rm(join(example, file));
  }
  await rm(temp, { recursive: true, force: true });
  await writeFrontend(frontend, "todo", example);
}

if (import.meta.main) {
  const check = process.argv.includes("--check");
  let failed = false;
  for (const frontend of ["astro", "next"] as const) {
    if (check) {
      const problems = await starterDrift(frontend);
      for (const problem of problems) console.error(problem);
      failed ||= problems.length > 0;
    } else {
      await write(frontend);
      console.log(`Wrote examples/${frontend}-starter`);
    }
  }
  if (failed) {
    console.error("The examples differ from the templates. Run bun scripts/sync-starters.ts.");
    process.exit(1);
  }
}
