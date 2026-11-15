import type { EntityAST, FieldAST, SchemaAST } from "./ast.ts";
export type DiffTier = "auto" | "safe" | "deprecate" | "abort";
export type DiffChange = {
    tier: "auto";
    kind: "add_entity";
    entity: EntityAST;
} | {
    tier: "auto";
    kind: "add_field";
    entity: string;
    field: FieldAST;
} | {
    tier: "auto";
    kind: "add_index";
    entity: string;
    fields: string[];
} | {
    tier: "safe";
    kind: "rename_entity";
    from: string;
    to: string;
} | {
    tier: "safe";
    kind: "rename_field";
    entity: string;
    from: string;
    to: string;
} | {
    tier: "deprecate";
    kind: "drop_entity";
    entity: string;
} | {
    tier: "deprecate";
    kind: "drop_field";
    entity: string;
    field: string;
} | {
    tier: "abort";
    kind: "breaking";
    message: string;
};
export interface DiffPlan {
    auto: DiffChange[];
    safe: DiffChange[];
    deprecate: DiffChange[];
    abort: DiffChange[];
}
export declare function diffSchemas(from: SchemaAST | null, to: SchemaAST): DiffPlan;
export declare function assertPlanApplyable(plan: DiffPlan): void;
