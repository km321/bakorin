import type { Hono } from "hono";
import type { Actor } from "../context.ts";
import type { BakorinDb } from "../db/dialects.ts";

export interface HookContext {
  entity: string;
  record: Record<string, unknown>;
  before?: Record<string, unknown> | null;
  actor: Actor | null;
  db: BakorinDb;
}

export interface EntityHooks {
  beforeCreate?: (ctx: HookContext) => Promise<Record<string, unknown> | void> | Record<string, unknown> | void;
  afterCreate?: (ctx: HookContext) => Promise<void> | void;
  beforeUpdate?: (ctx: HookContext) => Promise<Record<string, unknown> | void> | Record<string, unknown> | void;
  afterUpdate?: (ctx: HookContext) => Promise<void> | void;
  beforeDelete?: (ctx: HookContext) => Promise<void> | void;
  afterDelete?: (ctx: HookContext) => Promise<void> | void;
}

/**
 * Optional project-local TypeScript module (runtime.hooks, default ./hooks.ts).
 * This is the customization escape hatch: per-entity lifecycle hooks plus
 * custom Hono routes. It is not a plugin system.
 */
export interface BakorinHooks {
  entities?: Record<string, EntityHooks>;
  routes?: (app: Hono) => void;
}
