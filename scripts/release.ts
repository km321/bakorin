import { mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";

const targets = [
  { target: "bun-linux-x64", outfile: "release/bakorin-linux-x64" },
  { target: "bun-linux-arm64", outfile: "release/bakorin-linux-arm64" },
  { target: "bun-darwin-arm64", outfile: "release/bakorin-darwin-arm64" },
] as const;

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} exited ${String(code)}`));
    });
  });
}

await mkdir("release", { recursive: true });
await run("bun", ["run", "build:ui"]);
for (const item of targets) {
  console.log(`building ${item.outfile} (${item.target})`);
  await run("bun", [
    "build",
    "--compile",
    "--minify",
    `--target=${item.target}`,
    `--outfile=${item.outfile}`,
    "packages/server/src/cli.ts",
  ]);
}
console.log("wrote linux-x64, linux-arm64, and darwin-arm64 binaries to release/");
