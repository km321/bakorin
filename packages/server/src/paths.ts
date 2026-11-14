import { isAbsolute, join } from "node:path";

export function resolveRuntimePath(projectDir: string, value: string): string {
  return isAbsolute(value) ? value : join(projectDir, value);
}
