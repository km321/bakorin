// Builder model: the draft types, option lists, and empty constructors the form edits.

import type { SchemaAST } from "./ast.ts";
import { FIELD_TYPES } from "./yaml-schema.ts";

export type BuilderFieldType = (typeof FIELD_TYPES)[number];
export const BUILDER_FIELD_TYPES: readonly BuilderFieldType[] = FIELD_TYPES;
export const POLICY_ACTIONS = ["read", "create", "update", "delete"] as const;
export type PolicyAction = (typeof POLICY_ACTIONS)[number];
export const ON_DELETE = ["restrict", "cascade", "set_null"] as const;
export const MAIL_EVENTS = ["create", "update", "delete"] as const;
export const WHEN_OPS = ["equals", "not", "in", "notIn", "exists"] as const;
export type WhenOp = (typeof WHEN_OPS)[number];
export type Writable = "any" | "admin" | "none";

export interface FieldDraft {
  name: string;
  type: BuilderFieldType;
  required: boolean;
  unique: boolean;
  index: boolean;
  /** Raw default as typed in the form; converted by field type on output. Empty means no default. */
  defaultValue: string;
  values: string[];
  to: string;
  onDelete: "" | (typeof ON_DELETE)[number];
  /** Relation only: a list of ids (many to many) instead of one. */
  many: boolean;
  secret: boolean;
  description: string;
  writable: Writable;
  renameFrom: string;
}

export interface EntityDraft {
  name: string;
  label: string;
  plural: string;
  display: string;
  description: string;
  auth: boolean;
  fields: FieldDraft[];
  /** Each index is a list of field names. */
  indexes: string[][];
  /** Empty list means "use the server default" for that action. */
  policies: Record<PolicyAction, string[]>;
  /** Optional request limits per action. An empty limit means no limit for that action. */
  rateLimit: Record<PolicyAction, RateLimitDraft>;
  /** Realtime change events: off (empty), full records, or ids only. */
  realtime: "" | "full" | "ids";
}

export interface RateLimitDraft {
  /** Requests allowed per window, as typed. Empty means no limit. */
  limit: string;
  /** Window like 30s, 10m, 1h, 1d. */
  window: string;
  per: "" | "ip" | "user";
}

export function emptyRateLimits(): Record<PolicyAction, RateLimitDraft> {
  return {
    read: { limit: "", window: "", per: "" },
    create: { limit: "", window: "", per: "" },
    update: { limit: "", window: "", per: "" },
    delete: { limit: "", window: "", per: "" },
  };
}

export interface WhenDraft {
  field: string;
  op: WhenOp;
  /** For equals/not: one value. For in/notIn: comma separated. For exists: "true" or "false". */
  value: string;
}

export interface MailDraft {
  name: string;
  entity: string;
  events: Array<(typeof MAIL_EVENTS)[number]>;
  to: string;
  cc: string;
  bcc: string;
  replyTo: string;
  subject: string;
  template: string;
  when: WhenDraft[];
  changed: string[];
  expand: string[];
  maxAttempts: string;
}

export interface JobDraft {
  name: string;
  cron: string;
  /** Empty means use the job name. */
  handler: string;
  /** Empty means UTC. */
  timezone: string;
  dryRun: boolean;
  /** Empty means the server default (300). */
  timeoutSeconds: string;
  enabled: boolean;
}

export interface AuthDraft {
  entity: string;
  identity: string;
  password: string;
  role: string;
  adminRole: string;
  requireVerifiedEmail: boolean;
  /** Empty means unset: signup follows the users create policy. */
  signup: "" | "open" | "invite" | "closed";
}

/** Optional white-label settings. Empty strings mean "not set"; all empty means no branding section. */
export interface BrandingDraft {
  name: string;
  primaryColor: string;
  accentColor: string;
  logo: string;
  favicon: string;
}

export const BRANDING_KEYS = ["name", "primaryColor", "accentColor", "logo", "favicon"] as const;

export function emptyBranding(): BrandingDraft {
  return { name: "", primaryColor: "", accentColor: "", logo: "", favicon: "" };
}

export interface BuilderConfig {
  app: { name: string; version: string; description: string };
  branding: BrandingDraft;
  /** Edited via a few fields (dialect, port, CORS); everything else is kept exactly as imported. */
  runtime: Record<string, unknown>;
  auth: AuthDraft;
  entities: EntityDraft[];
  /** Webhooks are not edited by the builder but are preserved on import. */
  webhooks: unknown[];
  mail: MailDraft[];
  jobs: JobDraft[];
}

export interface BuilderIssue {
  /** Form location, e.g. "entities.1.fields.0.to", "auth.role", "mail.0.template", or "" for general. */
  target: string;
  message: string;
  severity: "error" | "warning";
}

export interface BuilderResult {
  yaml: string;
  issues: BuilderIssue[];
  ast?: SchemaAST;
  /** Template files the server will look for in mail/ at boot. */
  mailFiles: string[];
  /** Environment variables referenced with no fallback. The server needs them at boot. */
  envVars: string[];
  /** Logo and favicon files the server will look for in branding/ at boot. */
  brandingFiles: string[];
}

export function emptyField(name = "", type: BuilderFieldType = "text"): FieldDraft {
  return {
    name,
    type,
    required: false,
    unique: false,
    index: false,
    defaultValue: "",
    values: [],
    to: "",
    onDelete: "",
    many: false,
    secret: false,
    description: "",
    writable: "any",
    renameFrom: "",
  };
}

export function emptyPolicies(): Record<PolicyAction, string[]> {
  return { read: [], create: [], update: [], delete: [] };
}

export function emptyEntity(name = ""): EntityDraft {
  return {
    name,
    label: "",
    plural: "",
    display: "",
    description: "",
    auth: false,
    fields: [],
    indexes: [],
    policies: emptyPolicies(),
    rateLimit: emptyRateLimits(),
    realtime: "",
  };
}

export function emptyMailRule(entity = ""): MailDraft {
  return {
    name: "",
    entity,
    events: ["create"],
    to: "",
    cc: "",
    bcc: "",
    replyTo: "",
    subject: "",
    template: "",
    when: [],
    changed: [],
    expand: [],
    maxAttempts: "",
  };
}

export function emptyJob(name = ""): JobDraft {
  return {
    name,
    cron: "0 * * * *",
    handler: "",
    timezone: "",
    dryRun: false,
    timeoutSeconds: "",
    enabled: true,
  };
}

export function defaultAuth(): AuthDraft {
  return { entity: "users", identity: "email", password: "password", role: "role", adminRole: "admin", requireVerifiedEmail: false, signup: "" };
}

export function cloneConfig(config: BuilderConfig): BuilderConfig {
  return structuredClone(config);
}

// ---------- import (YAML text -> drafts) ----------

export function entityIndex(config: BuilderConfig, name: string): number {
  return config.entities.findIndex((entity) => entity.name === name);
}

export function fieldIndex(entity: EntityDraft | undefined, name: string): number {
  return entity ? entity.fields.findIndex((field) => field.name === name) : -1;
}
