import pkg from "../package.json" with { type: "json" };

/** Server version from package.json, or BAKORIN_VERSION when a build sets it. */
export function serverVersion(env: Record<string, string | undefined> = process.env): string {
  return env.BAKORIN_VERSION?.trim() || (pkg as { version?: string }).version || "0.0.0";
}
