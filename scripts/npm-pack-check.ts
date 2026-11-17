/**
 * Build and pack each public package the way the release does (`bun pm pack`),
 * then check the tarball:
 *   - LICENSE, README.md, package.json and dist/ are present
 *   - the license field matches the license split
 *   - no workspace: ranges are left in package.json
 *   - no .env files, node_modules, tests or other junk
 *
 *   bun scripts/npm-pack-check.ts
 */
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const PACKAGES = [
  { dir: "packages/core", name: "@bakorin/core", license: "AGPL-3.0-only" },
  { dir: "packages/server", name: "@bakorin/server", license: "AGPL-3.0-only" },
  { dir: "packages/sdk", name: "@bakorin/sdk", license: "MIT" },
  { dir: "packages/create-bakorin", name: "create-bakorin", license: "MIT" },
];

const JUNK = [
  /(^|\/)node_modules\//,
  /(^|\/)\.env($|\.)/,
  /\.(test|spec)\.[cm]?[jt]sx?$/,
  /(^|\/)(__tests__|tests?|coverage|\.turbo|\.astro|\.next)\//,
  /\.(db|sqlite|sqlite3|log|tgz|pem|key)$/,
  /(^|\/)\.DS_Store$/,
  /(^|\/)\.npmrc$/,
  /(^|\/)tsconfig\.tsbuildinfo$/,
];

async function run(cmd: string[], cwd: string): Promise<{ code: number; out: string; err: string }> {
  const proc = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  return { code, out, err };
}

function kb(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(2)} MB` : `${(bytes / 1024).toFixed(1)} KB`;
}

let failed = false;
const scratch = await mkdtemp(join(tmpdir(), "bakorin-pack-"));
try {
  for (const item of PACKAGES) {
    const cwd = join(ROOT, item.dir);
    const problems: string[] = [];
    const build = await run(["bun", "run", "build"], cwd);
    if (build.code !== 0) {
      console.error(build.out, build.err);
      throw new Error(`build failed for ${item.name}`);
    }
    const dest = join(scratch, item.name.replace("/", "-"));
    const pack = await run(["bun", "pm", "pack", "--destination", dest, "--quiet"], cwd);
    if (pack.code !== 0) throw new Error(`pack failed for ${item.name}: ${pack.err}`);
    const tarball = join(dest, (await readdir(dest)).find((f) => f.endsWith(".tgz"))!);
    const list = await run(["tar", "-tvzf", tarball], ROOT);
    const entries = list.out
      .trim()
      .split("\n")
      .map((line) => {
        const parts = line.trim().split(/\s+/);
        return { size: Number(parts[2]), path: parts.slice(5).join(" ").replace(/^package\//, "") };
      })
      .filter((e) => e.path && !e.path.endsWith("/"));
    const files = entries.map((e) => e.path);
    for (const need of ["package.json", "LICENSE", "README.md"]) if (!files.includes(need)) problems.push(`missing ${need}`);
    if (!files.some((f) => f.startsWith("dist/"))) problems.push("missing dist/");
    const junk = files.filter((f) => JUNK.some((re) => re.test(f)));
    if (junk.length) problems.push(`junk: ${junk.join(", ")}`);

    const manifest = JSON.parse((await run(["tar", "-xOzf", tarball, "package/package.json"], ROOT)).out) as {
      license?: string;
      dependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
    if (manifest.license !== item.license) problems.push(`license is ${manifest.license}, expected ${item.license}`);
    const license = (await run(["tar", "-xOzf", tarball, "package/LICENSE"], ROOT)).out;
    const wantText = item.license === "MIT" ? "MIT License" : "GNU AFFERO GENERAL PUBLIC LICENSE";
    if (!license.includes(wantText)) problems.push(`LICENSE text does not look like ${item.license}`);
    for (const [dep, range] of Object.entries({ ...manifest.dependencies, ...manifest.peerDependencies })) {
      if (range.startsWith("workspace:")) problems.push(`${dep} still ${range}`);
    }

    const total = entries.reduce((sum, e) => sum + e.size, 0);
    const packed = (await Bun.file(tarball).arrayBuffer()).byteLength;
    console.log(`\n${item.name}: ${files.length} files, ${kb(total)} unpacked, ${kb(packed)} packed, license ${manifest.license}`);
    const byTop = new Map<string, { n: number; size: number }>();
    for (const e of entries) {
      const top = e.path.includes("/") ? `${e.path.split("/")[0]}/` : e.path;
      const cur = byTop.get(top) ?? { n: 0, size: 0 };
      byTop.set(top, { n: cur.n + 1, size: cur.size + e.size });
    }
    for (const [top, v] of [...byTop].sort()) console.log(`  ${top.padEnd(16)} ${String(v.n).padStart(4)} files  ${kb(v.size)}`);
    const internal = Object.entries(manifest.dependencies ?? {}).filter(([d]) => d.startsWith("@bakorin/"));
    if (internal.length) console.log(`  deps: ${internal.map(([d, r]) => `${d}@${r}`).join(", ")}`);
    if (problems.length) {
      failed = true;
      for (const p of problems) console.error(`  FAIL ${p}`);
    } else console.log("  ok");
  }
} finally {
  await rm(scratch, { recursive: true, force: true });
}
if (failed) process.exit(1);
