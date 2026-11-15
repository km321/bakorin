#!/usr/bin/env bun
import { spawn } from "node:child_process";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const PACKAGES = [
  { dir: "packages/core", name: "@bakorin/core" },
  { dir: "packages/sdk", name: "@bakorin/sdk" },
  { dir: "packages/server", name: "@bakorin/server" },
  { dir: "packages/create-bakorin", name: "create-bakorin" },
];

interface PackOutput {
  filename?: string;
  name?: string;
  version?: string;
  files?: Array<{ path: string }>;
  entryCount?: number;
  unpackedSize?: number;
  size?: number;
}

function run(command: string, args: string[], cwd: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

function parsePack(stdout: string, stderr: string): PackOutput {
  const text = stdout.trim() || stderr.trim();
  const start = text.search(/[\[{]/);
  if (start < 0) {
    throw new Error(`npm pack did not print JSON:\n${stdout}\n${stderr}`);
  }
  const parsed: unknown = JSON.parse(text.slice(start));
  if (Array.isArray(parsed)) {
    const first = parsed[0];
    if (!first || typeof first !== "object") {
      throw new Error("npm pack JSON array was empty");
    }
    return first as PackOutput;
  }
  return parsed as PackOutput;
}

async function main(): Promise<void> {
  for (const item of PACKAGES) {
    const cwd = join(ROOT, item.dir);
    const build = await run("bun", ["run", "build"], cwd);
    if (build.code !== 0) {
      console.error(`build failed for ${item.name}\n${build.stdout}\n${build.stderr}`);
      process.exit(build.code);
    }
    const packed = await run("npm", ["pack", "--dry-run", "--json"], cwd);
    if (packed.code !== 0) {
      console.error(`npm pack failed for ${item.name}\n${packed.stdout}\n${packed.stderr}`);
      process.exit(packed.code);
    }
    const json = parsePack(packed.stdout, packed.stderr);
    const files = (json.files ?? []).map((file) => file.path).sort();
    console.log(`\n${item.name} ${json.filename ?? ""}`);
    console.log(`  files: ${json.entryCount ?? files.length}  packed: ${json.size ?? "?"}  unpacked: ${json.unpackedSize ?? "?"}`);
    for (const path of files) {
      console.log(`  ${path}`);
    }
    const forbidden = files.filter(
      (path) => path.includes("node_modules") || path.endsWith(".env") || path.includes(".env."),
    );
    if (forbidden.length > 0) {
      console.error(`refusing: ${item.name} would pack ${forbidden.join(", ")}`);
      process.exit(1);
    }
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
