/** JWT secret rules and dev mode detection. */
export declare const DEV_JWT_SECRET = "dev-only-change-me";
export declare const MIN_JWT_SECRET_LENGTH = 32;
/**
 * Explicit development or test mode: `bakorin dev` sets BAKORIN_ENV=development,
 * and the test preload sets BAKORIN_TEST=1. Everything else is production, so a
 * server started any other way never runs on the public dev secret.
 */
export declare function isDevMode(env: Record<string, string | undefined>): boolean;
/** Why a JWT secret is too weak for production, or null when it is fine. */
export declare function weakJwtSecretReason(secret: string | undefined): string | null;
export declare function assertStrongJwtSecret(secret: string | undefined, name?: string): void;
