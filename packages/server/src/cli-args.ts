/** Command line flags and the project folder. */

import { resolve } from "node:path";

export function arg(flag: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index >= 0) {
    return process.argv[index + 1] ?? fallback;
  }
  return fallback;
}

export function projectDir(): string {
  return resolve(arg("--dir", process.cwd()) ?? process.cwd());
}

export function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}
