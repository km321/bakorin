import { type BuilderConfig } from "./builder-model.ts";
/** Plain object in app.yaml key order. Duplicate names collapse here, so check builderIssues first. */
export declare function toAppObject(config: BuilderConfig): Record<string, unknown>;
/** Render config as app.yaml text in the same compact style as the starters. */
export declare function toAppYaml(config: BuilderConfig): string;
/** Env vars referenced without a fallback. The builder fills in placeholders so it can validate. */
export declare function requiredEnvVars(yamlText: string): string[];
