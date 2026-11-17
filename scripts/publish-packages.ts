/**
 * Publish the four public Bakorin packages, in dependency order:
 *   1. @bakorin/core
 *   2. @bakorin/server and @bakorin/sdk
 *   3. create-bakorin
 *
 * Each package is packed with `bun pm pack`, which swaps `workspace:*` for the
 * real version, then the tarball goes up with `npm publish`. npm handles
 * trusted publishing (OIDC) in CI, and adds provenance on its own when the
 * repository is public. Versions already on the registry are skipped, so a
 * failed release can be rerun.
 *
 *   bun scripts/publish-packages.ts            publish
 *   bun scripts/publish-packages.ts --dry-run  pack and npm publish --dry-run
 *
 * The registry comes from npm config (NPM_CONFIG_REGISTRY or .npmrc), so the
 * same script publishes to a local verdaccio for testing.
 */
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const ORDER: string[][] = [
  ["packages/core"],
  ["packages/server", "packages/sdk"],
  ["packages/create-bakorin"],
];

const dryRun = process.argv.includes("--dry-run");

async function run(cmd: string[], cwd: string, quiet = false, silent = false): Promise<{ code: number; out: string }> {
  const proc = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe", env: process.env });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (!silent && (!quiet || code !== 0)) {
    if (out.trim()) console.log(out.trim());
    if (err.trim()) console.error(err.trim());
  }
  return { code, out };
}

/** beta for 0.1.0-beta.0, latest for 1.0.0. */
function distTag(version: string): string {
  const pre = version.split("-")[1];
  return pre ? (pre.split(".")[0] ?? "beta") : "latest";
}

async function published(name: string, version: string): Promise<boolean> {
  const res = await run(["npm", "view", `${name}@${version}`, "version"], ROOT, true, true).catch(() => ({ code: 1, out: "" }));
  return res.code === 0 && res.out.trim() === version;
}

async function publishOne(dir: string, scratch: string): Promise<void> {
  const cwd = join(ROOT, dir);
  const pkg = (await Bun.file(join(cwd, "package.json")).json()) as { name: string; version: string; private?: boolean };
  if (pkg.private) throw new Error(`${pkg.name} is private`);
  const label = `${pkg.name}@${pkg.version}`;
  if (!dryRun && (await published(pkg.name, pkg.version))) {
    console.log(`skip ${label} (already published)`);
    return;
  }
  const build = await run(["bun", "run", "build"], cwd, true);
  if (build.code !== 0) throw new Error(`build failed for ${label}`);
  const dest = join(scratch, pkg.name.replace("/", "-"));
  const pack = await run(["bun", "pm", "pack", "--destination", dest, "--quiet"], cwd, true);
  if (pack.code !== 0) throw new Error(`pack failed for ${label}`);
  const tarball = (await readdir(dest)).find((f) => f.endsWith(".tgz"));
  if (!tarball) throw new Error(`no tarball for ${label}`);
  const args = ["npm", "publish", join(dest, tarball), "--access", "public", "--tag", distTag(pkg.version)];
  if (dryRun) args.push("--dry-run");
  const res = await run(args, ROOT, true);
  if (res.code !== 0) throw new Error(`npm publish failed for ${label}`);
  console.log(`${dryRun ? "dry run ok" : "published"} ${label} (tag ${distTag(pkg.version)})`);
  // changesets/action reads this line to create the GitHub release and git tag.
  if (!dryRun) console.log(`New tag: ${label}`);
}

// Unreleased changesets mean the versions in package.json are stale. Version
// first (the "Version Packages" PR), then publish.
// In prerelease mode the changeset files stay after versioning and are listed
// in pre.json, so those count as released.
const preFile = Bun.file(join(ROOT, ".changeset", "pre.json"));
const released = new Set(
  (await preFile.exists()) ? ((await preFile.json()) as { changesets?: string[] }).changesets ?? [] : [],
);
const pending = (await readdir(join(ROOT, ".changeset"))).filter(
  (f) => f.endsWith(".md") && f !== "README.md" && !released.has(f.slice(0, -3)),
);
if (pending.length && !dryRun) {
  console.error(`Refusing to publish: unreleased changesets in .changeset/ (${pending.join(", ")}). Run bun run version-packages first.`);
  process.exit(1);
}

const scratch = await mkdtemp(join(tmpdir(), "bakorin-publish-"));
try {
  for (const step of ORDER) {
    // Packages in one step do not depend on each other, but run them one at a
    // time so the log reads cleanly and a failure stops the next step.
    for (const dir of step) await publishOne(dir, scratch);
  }
} finally {
  await rm(scratch, { recursive: true, force: true });
}
