/** Compile the top-level jobs: list in app.yaml. */
import { type JobAST } from "./ast.ts";
import type { AppYaml } from "./yaml-schema.ts";
export declare function compileJobs(doc: AppYaml): JobAST[];
