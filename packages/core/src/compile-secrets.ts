/** JWT secret rules and dev mode detection. */

import { SchemaError } from "./errors.ts";

export const DEV_JWT_SECRET = "dev-only-change-me";
export const MIN_JWT_SECRET_LENGTH = 32;

const PLACEHOLDER_SECRET = /change[-_ ]?me|replace[-_ ]?me|your[-_ ]?secret|dev[-_ ]?only|example|placeholder/i;

/**
 * Explicit development or test mode: `bakorin dev` sets BAKORIN_ENV=development,
 * and the test preload sets BAKORIN_TEST=1. Everything else is production, so a
 * server started any other way never runs on the public dev secret.
 */
export function isDevMode(env: Record<string, string | undefined>): boolean {
  const mode = (env.BAKORIN_ENV ?? "").trim().toLowerCase();
  if (mode === "production") {
    return false;
  }
  return mode === "development" || mode === "dev" || mode === "test" || env.BAKORIN_TEST === "1";
}

/** Why a JWT secret is too weak for production, or null when it is fine. */
export function weakJwtSecretReason(secret: string | undefined): string | null {
  if (!secret) {
    return "it is not set";
  }
  if (secret === DEV_JWT_SECRET || PLACEHOLDER_SECRET.test(secret)) {
    return "it is a placeholder value";
  }
  if (secret.length < MIN_JWT_SECRET_LENGTH) {
    return `it is ${secret.length} characters; use at least ${MIN_JWT_SECRET_LENGTH}`;
  }
  if (new Set(secret).size < 10) {
    return "it repeats too few characters to be random";
  }
  return null;
}

export function assertStrongJwtSecret(secret: string | undefined, name = "JWT_SECRET"): void {
  const reason = weakJwtSecretReason(secret);
  if (reason) {
    throw new SchemaError(
      `${name} is too weak for production: ${reason}. Generate one with: openssl rand -base64 48. ` +
        "Only `bakorin dev` (BAKORIN_ENV=development) runs without a strong secret.",
    );
  }
}
