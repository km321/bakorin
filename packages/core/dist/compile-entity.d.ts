/** Fields, policies, indexes, display, names, and rate limits for one entity. */
import { type AppYaml, type RawField } from "./yaml-schema.ts";
import type { ActionName, FieldAST, PolicyAST, RateLimitAST } from "./ast.ts";
export declare const SYSTEM_FIELDS: Set<string>;
export declare function asFieldObject(value: AppYaml["entities"][string]["fields"][string]): RawField;
export declare function compileField(entityName: string, name: string, raw: RawField): FieldAST;
export declare function systemFields(): FieldAST[];
export declare function defaultPolicies(auth: boolean): Record<ActionName, PolicyAST[]>;
export declare function resolveDisplay(entityName: string, fields: FieldAST[], requested: string | undefined): string;
export declare function titleCase(name: string): string;
export declare function pluralize(name: string): string;
/**
 * runtime.trustProxy (or TRUST_PROXY): false or 0 for none, a hop count such as 1,
 * true for one hop, or a list of proxy CIDRs. The env var wins so a host can set it.
 */
/** API prefixes Bakorin mounts under /api/v1. An entity with one of these names would be shadowed. */
export declare const RESERVED_ENTITY_NAMES: readonly ["auth", "audit", "backups", "docs", "files", "mail", "realtime", "status", "webhooks", "_meta"];
export declare function assertEntityRouteFree(name: string): void;
export declare function compileIndexes(entityName: string, fieldMap: Record<string, {
    name: string;
}>, raw: Array<string | string[]> | undefined): string[][];
type RawRateLimit = {
    limit: number;
    window: string | number;
    per?: "ip" | "user";
};
export declare function rateWindowSeconds(window: string | number): number;
export declare function compileRateLimit(raw: RawRateLimit): RateLimitAST;
export declare function compileEntityRateLimit(raw: Partial<Record<ActionName, RawRateLimit>>): Partial<Record<ActionName, RateLimitAST>>;
export {};
