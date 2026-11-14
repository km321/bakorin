import { SchemaError } from "./errors.ts";

const ENV_TOKEN = /\$\{([A-Z][A-Z0-9_]*)(?::-([^}]*))?\}/g;

export function interpolateEnv(source: string, env: Record<string, string | undefined> = process.env): string {
  return source.replace(ENV_TOKEN, (match, name: string, fallback?: string) => {
    const value = env[name];
    if (value !== undefined && value !== "") {
      return value;
    }
    if (fallback !== undefined) {
      return fallback;
    }
    throw new SchemaError(`missing environment variable ${name} referenced from app.yaml`, { match });
  });
}
