import { type BuilderConfig, type BuilderIssue, type BuilderResult } from "./builder-model.ts";
/** Problems the YAML itself cannot show: duplicate or blank names collapse into one key. */
export declare function builderIssues(config: BuilderConfig): BuilderIssue[];
/**
 * Build the YAML and check it the way the server does at boot:
 * 1. builder-only checks (duplicate names),
 * 2. the server's Zod schema (appYamlSchema),
 * 3. the server's compiler (compileAppYaml), which checks relations, policies, auth, and mail rules.
 */
export declare function validateConfig(config: BuilderConfig): BuilderResult;
/** Rough "is this name usable as an identifier" check for the form. */
export declare function isIdentifier(value: string): boolean;
