import { type SchemaAST } from "./ast.ts";
export { RESERVED_ENTITY_NAMES, rateWindowSeconds } from "./compile-entity.ts";
export { DEFAULT_ALLOWED_MIME_TYPES, parseTrustProxy } from "./compile-runtime.ts";
export { DEV_JWT_SECRET, MIN_JWT_SECRET_LENGTH, assertStrongJwtSecret, isDevMode, weakJwtSecretReason } from "./compile-secrets.ts";
export { deserializeAst, serializeAst } from "./compile-serialize.ts";
export interface CompileOptions {
    env?: Record<string, string | undefined>;
    production?: boolean;
}
export declare function compileAppYaml(source: string, options?: CompileOptions): SchemaAST;
