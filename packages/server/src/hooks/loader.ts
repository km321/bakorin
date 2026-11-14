import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import type { BakorinHooks } from "./types.ts";

export async function loadHooks(projectDir: string, hooksPath: string | undefined): Promise<BakorinHooks> {
  if (!hooksPath) {
    return {};
  }
  const absolute = resolve(projectDir, hooksPath);
  const file = Bun.file(absolute);
  if (!(await file.exists())) {
    return {};
  }
  const mod = (await import(pathToFileURL(absolute).href)) as {
    default?: BakorinHooks;
    hooks?: BakorinHooks;
  };
  return mod.default ?? mod.hooks ?? {};
}
