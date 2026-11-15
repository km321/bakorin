import { join, resolve } from "node:path";

export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const eq = line.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    const key = line.slice(0, eq).trim();
    if (!key) {
      continue;
    }
    let value = line.slice(eq + 1);
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

export async function applyProjectEnv(
  projectDir: string,
  env: Record<string, string | undefined> = process.env,
  cwd: string = process.cwd(),
): Promise<string[]> {
  const loaded: string[] = [];
  const cwdFile = resolve(cwd, ".env");
  const dirFile = resolve(projectDir, ".env");

  const apply = async (file: string, override: boolean): Promise<void> => {
    if (!(await Bun.file(file).exists())) {
      return;
    }
    const parsed = parseEnvFile(await Bun.file(file).text());
    for (const [key, value] of Object.entries(parsed)) {
      if (override || env[key] === undefined || env[key] === "") {
        env[key] = value;
      }
    }
    loaded.push(file);
  };

  await apply(cwdFile, false);
  if (dirFile !== cwdFile) {
    await apply(dirFile, true);
  }

  return loaded;
}

export function envFilesFor(projectDir: string, cwd: string = process.cwd()): { cwdFile: string; dirFile: string } {
  return {
    cwdFile: join(resolve(cwd), ".env"),
    dirFile: join(resolve(projectDir), ".env"),
  };
}
