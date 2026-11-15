import { type SchemaAST } from "./ast.ts";
export declare const DEV_JWT_SECRET = "dev-only-change-me";
export declare const DEFAULT_ALLOWED_MIME_TYPES: string[];
export interface CompileOptions {
    env?: Record<string, string | undefined>;
    production?: boolean;
}
export declare function compileAppYaml(source: string, options?: CompileOptions): SchemaAST;
export declare function serializeAst(ast: SchemaAST): string;
export declare function deserializeAst(raw: string): SchemaAST;
