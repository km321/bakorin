import type { SchemaAST } from "./ast.ts";
import { FIELD_TYPES } from "./yaml-schema.ts";
export type BuilderFieldType = (typeof FIELD_TYPES)[number];
export declare const BUILDER_FIELD_TYPES: readonly BuilderFieldType[];
export declare const POLICY_ACTIONS: readonly ["read", "create", "update", "delete"];
export type PolicyAction = (typeof POLICY_ACTIONS)[number];
export declare const ON_DELETE: readonly ["restrict", "cascade", "set_null"];
export declare const MAIL_EVENTS: readonly ["create", "update", "delete"];
export declare const WHEN_OPS: readonly ["equals", "not", "in", "notIn", "exists"];
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
export interface AuthDraft {
    entity: string;
    identity: string;
    password: string;
    role: string;
    adminRole: string;
    requireVerifiedEmail: boolean;
}
/** Optional white-label settings. Empty strings mean "not set"; all empty means no branding section. */
export interface BrandingDraft {
    name: string;
    primaryColor: string;
    accentColor: string;
    logo: string;
    favicon: string;
}
export declare const BRANDING_KEYS: readonly ["name", "primaryColor", "accentColor", "logo", "favicon"];
export declare function emptyBranding(): BrandingDraft;
export interface BuilderConfig {
    app: {
        name: string;
        version: string;
        description: string;
    };
    branding: BrandingDraft;
    /** Edited via a few fields (dialect, port, CORS); everything else is kept exactly as imported. */
    runtime: Record<string, unknown>;
    auth: AuthDraft;
    entities: EntityDraft[];
    /** Webhooks are not edited by the builder but are preserved on import. */
    webhooks: unknown[];
    mail: MailDraft[];
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
export declare function emptyField(name?: string, type?: BuilderFieldType): FieldDraft;
export declare function emptyPolicies(): Record<PolicyAction, string[]>;
export declare function emptyEntity(name?: string): EntityDraft;
export declare function emptyMailRule(entity?: string): MailDraft;
export declare function defaultAuth(): AuthDraft;
export declare function cloneConfig(config: BuilderConfig): BuilderConfig;
export interface ImportResult {
    config: BuilderConfig;
    warnings: string[];
}
/** Parse an existing app.yaml into builder drafts. Throws on YAML syntax errors. */
export declare function importAppYaml(source: string): ImportResult;
/** Plain object in app.yaml key order. Duplicate names collapse here, so check builderIssues first. */
export declare function toAppObject(config: BuilderConfig): Record<string, unknown>;
/** Render config as app.yaml text in the same compact style as the starters. */
export declare function toAppYaml(config: BuilderConfig): string;
/** Env vars referenced without a fallback. The builder fills in placeholders so it can validate. */
export declare function requiredEnvVars(yamlText: string): string[];
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
