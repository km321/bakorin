/** The runtime section of app.yaml: env overrides, storage, proxies, realtime, MCP, limits. */
import type { AppYaml } from "./yaml-schema.ts";
import { type RuntimeAST, type TrustProxyAST } from "./ast.ts";
export declare function compileRuntime(yaml: AppYaml, production: boolean, env: Record<string, string | undefined>): RuntimeAST;
export declare function parseTrustProxy(yaml: boolean | number | string[] | undefined, env: Record<string, string | undefined>): TrustProxyAST;
export declare const DEFAULT_ALLOWED_MIME_TYPES: string[];
