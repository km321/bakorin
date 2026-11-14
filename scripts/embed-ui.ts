import { readdir, readFile, writeFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";

const dist = join(import.meta.dir, "../packages/admin-ui/dist");
const out = join(import.meta.dir, "../packages/server/src/embedded-ui.ts");

const TEXT = new Set([".html", ".js", ".css", ".svg", ".json", ".txt", ".map"]);

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(path)));
    } else {
      files.push(path);
    }
  }
  return files;
}

const files = await walk(dist).catch(() => [] as string[]);
const entries: string[] = [];
for (const path of files) {
  const rel = relative(dist, path).split("\\").join("/");
  const buf = await readFile(path);
  const encoding = TEXT.has(extname(path)) ? "utf8" : "base64";
  const content = encoding === "utf8" ? buf.toString("utf8") : buf.toString("base64");
  entries.push(`  ${JSON.stringify(rel)}: { content: ${JSON.stringify(content)}, encoding: ${JSON.stringify(encoding)} }`);
}

await writeFile(
  out,
  `export const embeddedUi: Record<string, { content: string; encoding: "utf8" | "base64" }> = {\n${entries.join(",\n")}\n};\n`,
);
console.log(`embedded ${files.length} admin UI files`);
