import { type BuilderConfig } from "./builder-model.ts";
export interface ImportResult {
    config: BuilderConfig;
    warnings: string[];
}
/** Parse an existing app.yaml into builder drafts. Throws on YAML syntax errors. */
export declare function importAppYaml(source: string): ImportResult;
