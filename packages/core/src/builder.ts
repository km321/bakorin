// Model behind the website's app.yaml config builder.
// Pure TypeScript (no DOM) so the browser page and bun tests share it.
// Validation goes through the same appYamlSchema and compileAppYaml the server runs at boot.

export { requiredEnvVars, toAppObject, toAppYaml } from "./builder-export.ts";
export { importAppYaml } from "./builder-import.ts";
export type { ImportResult } from "./builder-import.ts";
export { BRANDING_KEYS, BUILDER_FIELD_TYPES, MAIL_EVENTS, ON_DELETE, POLICY_ACTIONS, WHEN_OPS, cloneConfig, defaultAuth, emptyBranding, emptyEntity, emptyField, emptyJob, emptyMailRule, emptyPolicies, emptyRateLimits } from "./builder-model.ts";
export type { AuthDraft, BrandingDraft, BuilderConfig, BuilderFieldType, BuilderIssue, BuilderResult, EntityDraft, FieldDraft, MailDraft, PolicyAction, RateLimitDraft, WhenDraft, WhenOp, Writable } from "./builder-model.ts";
export { builderIssues, isIdentifier, validateConfig } from "./builder-validate.ts";
