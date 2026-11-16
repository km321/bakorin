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
    hint?: string;
} | {
    tier: "deprecate";
    kind: "drop_field";
    entity: string;
    field: string;
    hint?: string;
} | {
    tier: "deprecate";
    kind: "remove_enum_values";
    entity: string;
    field: string;
    values: string[];
} | {
    tier: "abort";
    kind: "breaking";
    message: string;
};
/**
 * auto: additive, applied on boot.
 * safe: renames declared with renameFrom, applied on boot after an automatic backup.
 * deprecate: removals (drop an entity or field, remove enum values). Data stays in the
 *   database, but the API stops serving it, so these need explicit confirmation.
 * abort: changes the migrator cannot do without losing or corrupting data.
 */
export interface DiffPlan {
    auto: DiffChange[];
    safe: DiffChange[];
    deprecate: DiffChange[];
    abort: DiffChange[];
}
export declare function diffSchemas(from: SchemaAST | null, to: SchemaAST): DiffPlan;
/** Plain-language line for a change, used by the CLI plan and boot errors. */
export declare function describeChange(change: DiffChange): string;
/** True when applying the plan needs an explicit confirmation. */
export declare function needsConfirmation(plan: DiffPlan): boolean;
/** True when the plan changes existing tables (renames or removals), so a backup is taken first. */
export declare function touchesExistingData(plan: DiffPlan): boolean;
/**
 * Short code that names exactly this set of destructive changes. Confirming with
 * the code means a stale confirmation cannot approve a different change later.
 */
export declare function destructiveCode(plan: DiffPlan): string;
/** Readable multi-line plan for the CLI and logs. */
export declare function formatPlan(plan: DiffPlan): string;
export declare function assertPlanApplyable(plan: DiffPlan): void;
