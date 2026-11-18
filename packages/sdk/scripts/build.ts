/**
 * Builds dist/: one ESM file per entry with shared chunks, so the headless code,
 * the React layer, and the elements share one copy of the client.
 */
import { $ } from "bun";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Bun picks the JSX dev runtime (jsxDEV) unless NODE_ENV is production when it bundles.
if (process.env.NODE_ENV !== "production") {
  const child = Bun.spawnSync([process.execPath, import.meta.path], { env: { ...process.env, NODE_ENV: "production" }, stdio: ["inherit", "inherit", "inherit"] });
  process.exit(child.exitCode ?? 1);
}

const root = join(import.meta.dir, "..");
const entries = ["index", "astro", "next", "browser", "proxy", "headless", "react", "elements", "astro-render", "richtext"].map((name) => join(root, "src", `${name}.ts`));

rmSync(join(root, "dist"), { recursive: true, force: true });
const result = await Bun.build({
  entrypoints: entries,
  outdir: join(root, "dist"),
  format: "esm",
  target: "node",
  splitting: true,
  external: ["react", "react-dom", "react/jsx-runtime"],
  naming: { entry: "[name].js", chunk: "chunks/[name]-[hash].js" },
});
if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
// Next.js needs the directive at the top of the file that client components import.
const reactFile = join(root, "dist", "react.js");
const react = readFileSync(reactFile, "utf8").replace(/^"use client";\n?/m, "");
writeFileSync(reactFile, `"use client";\n${react}`);
for (const file of [reactFile]) {
  if (readFileSync(file, "utf8").includes("jsx-dev-runtime")) {
    console.error("dist/react.js uses the JSX dev runtime");
    process.exit(1);
  }
}
await $`bunx tsc -p tsconfig.json --emitDeclarationOnly --declaration --allowImportingTsExtensions`.cwd(root);
