import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import type { BakorinHooks } from "./types.ts";

/**
 * Load hooks.ts. With `fresh`, the module cache entry is dropped first, so a dev
 * reload picks up edits instead of the copy imported at boot.
 */
export async function loadHooks(
  projectDir: string,
  hooksPath: string | undefined,
  options: { fresh?: boolean } = {},
): Promise<BakorinHooks> {
  if (!hooksPath) {
    return {};
  }
  const absolute = resolve(projectDir, hooksPath);
  const file = Bun.file(absolute);
  if (!(await file.exists())) {
    return {};
  }
  if (options.fresh) {
    delete require.cache[absolute];
  }
  const mod = (await import(pathToFileURL(absolute).href)) as {
    default?: BakorinHooks;
    hooks?: BakorinHooks;
  };
  return mod.default ?? mod.hooks ?? {};
}
