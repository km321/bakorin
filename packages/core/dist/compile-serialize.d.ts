/** Stored schema: secrets are redacted before the AST is written to the database. */
import { type SchemaAST } from "./ast.ts";
export declare function serializeAst(ast: SchemaAST): string;
export declare function deserializeAst(raw: string): SchemaAST;
