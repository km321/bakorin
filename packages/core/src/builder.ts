// Model behind the website's app.yaml config builder.
// Pure TypeScript (no DOM) so the browser page and bun tests share it.
// Validation goes through the same appYamlSchema and compileAppYaml the server runs at boot.
import { Document, isMap, isSeq, parse as parseYaml, visit, type Node as YamlNode } from "yaml";
import type { SchemaAST } from "./ast.ts";
import { compileAppYaml } from "./compile.ts";
import { BakorinError } from "./errors.ts";
import { formatZodError } from "./format-schema.ts";
import { appYamlSchema, FIELD_TYPES } from "./yaml-schema.ts";

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

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

// ---------- constructors ----------

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

export function defaultAuth(): AuthDraft {
  return { entity: "users", identity: "email", password: "password", role: "role", adminRole: "admin", requireVerifiedEmail: false, signup: "" };
}

export function cloneConfig(config: BuilderConfig): BuilderConfig {
  return structuredClone(config);
}

// ---------- import (YAML text -> drafts) ----------

function str(value: unknown): string {
  if (value === undefined || value === null) return "";
  return typeof value === "string" ? value : String(value);
}

function strList(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  return (Array.isArray(value) ? value : [value]).map((item) => str(item));
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function fieldFromRaw(name: string, raw: unknown, warnings: string[], where: string): FieldDraft {
  const field = emptyField(name);
  const obj = typeof raw === "string" ? { type: raw } : record(raw);
  const type = str(obj.type);
  field.type = (BUILDER_FIELD_TYPES as readonly string[]).includes(type) ? (type as BuilderFieldType) : "text";
  if (field.type !== type) warnings.push(`${where}: unknown type ${JSON.stringify(type)}, changed to text`);
  // Same rule as the compiler: a default makes the field required unless required: false is set.
  field.required = obj.required === true || (obj.default !== undefined && obj.required !== false);
  field.unique = obj.unique === true;
  field.index = obj.index === true;
  field.defaultValue = obj.default === undefined || obj.default === null ? "" : str(obj.default);
  field.values = strList(obj.values);
  field.to = str(obj.to);
  field.onDelete = (ON_DELETE as readonly string[]).includes(str(obj.onDelete)) ? (str(obj.onDelete) as FieldDraft["onDelete"]) : "";
  field.secret = obj.secret === true;
  field.description = str(obj.description);
  field.renameFrom = str(obj.renameFrom);
  if (obj.writable === "admin" || obj.adminOnly === true) field.writable = "admin";
  if (obj.writable === "none" || obj.readonly === true) field.writable = "none";
  return field;
}

function whenFromRaw(field: string, raw: unknown): WhenDraft {
  if (raw === null || typeof raw !== "object") return { field, op: "equals", value: str(raw) };
  const obj = raw as Record<string, unknown>;
  if (Array.isArray(obj.in)) return { field, op: "in", value: obj.in.map(str).join(", ") };
  if (Array.isArray(obj.notIn)) return { field, op: "notIn", value: obj.notIn.map(str).join(", ") };
  if (obj.exists !== undefined) return { field, op: "exists", value: obj.exists === false ? "false" : "true" };
  if ("not" in obj) return { field, op: "not", value: str(obj.not) };
  return { field, op: "equals", value: str(obj.equals) };
}

export interface ImportResult {
  config: BuilderConfig;
  warnings: string[];
}

/** Parse an existing app.yaml into builder drafts. Throws on YAML syntax errors. */
export function importAppYaml(source: string): ImportResult {
  const warnings: string[] = [];
  let parsed: unknown;
  try {
    parsed = parseYaml(source);
  } catch (error) {
    throw new BakorinError("yaml_invalid", `This is not valid YAML: ${error instanceof Error ? error.message : String(error)}`);
  }
  const root = record(parsed);
  const known = new Set(["app", "branding", "runtime", "auth", "entities", "webhooks", "mail"]);
  for (const key of Object.keys(root)) {
    if (!known.has(key)) warnings.push(`Top-level key "${key}" is not part of app.yaml and was dropped.`);
  }
  const app = record(root.app);
  const authRaw = record(root.auth);
  const brandingRaw = record(root.branding);
  const branding = emptyBranding();
  for (const key of BRANDING_KEYS) branding[key] = str(brandingRaw[key]);
  for (const key of Object.keys(brandingRaw)) {
    if (!(BRANDING_KEYS as readonly string[]).includes(key)) warnings.push(`branding.${key} is not a branding option and was dropped.`);
  }
  const config: BuilderConfig = {
    app: { name: str(app.name), version: str(app.version), description: str(app.description) },
    branding,
    runtime: record(root.runtime),
    auth: {
      entity: str(authRaw.entity),
      identity: str(authRaw.identity),
      password: str(authRaw.password),
      role: str(authRaw.role),
      adminRole: str(authRaw.adminRole),
      requireVerifiedEmail: authRaw.requireVerifiedEmail === true,
      signup: authRaw.signup === "open" || authRaw.signup === "invite" || authRaw.signup === "closed" ? authRaw.signup : "",
    },
    entities: [],
    webhooks: Array.isArray(root.webhooks) ? root.webhooks : [],
    mail: [],
  };
  for (const [name, rawEntity] of Object.entries(record(root.entities))) {
    const raw = record(rawEntity);
    const entity = emptyEntity(name);
    entity.label = str(raw.label);
    entity.plural = str(raw.plural);
    entity.display = str(raw.display);
    entity.description = str(raw.description);
    entity.auth = raw.auth === true;
    entity.fields = Object.entries(record(raw.fields)).map(([fieldName, value]) =>
      fieldFromRaw(fieldName, value, warnings, `entities.${name}.fields.${fieldName}`),
    );
    entity.indexes = (Array.isArray(raw.indexes) ? raw.indexes : []).map((item) => strList(item));
    const policies = record(raw.policies);
    for (const action of POLICY_ACTIONS) entity.policies[action] = strList(policies[action]);
    config.entities.push(entity);
  }
  for (const rawRule of Array.isArray(root.mail) ? root.mail : []) {
    const raw = record(rawRule);
    const rule = emptyMailRule(str(raw.entity));
    rule.name = str(raw.name);
    rule.events = strList(raw.events).filter((event): event is MailDraft["events"][number] =>
      (MAIL_EVENTS as readonly string[]).includes(event),
    );
    rule.to = strList(raw.to).join(", ");
    rule.cc = strList(raw.cc).join(", ");
    rule.bcc = strList(raw.bcc).join(", ");
    rule.replyTo = str(raw.replyTo);
    rule.subject = str(raw.subject);
    rule.template = str(raw.template);
    rule.when = Object.entries(record(raw.when)).map(([field, value]) => whenFromRaw(field, value));
    rule.changed = strList(raw.changed);
    rule.expand = strList(raw.expand);
    rule.maxAttempts = raw.maxAttempts === undefined ? "" : str(raw.maxAttempts);
    config.mail.push(rule);
  }
  return { config, warnings };
}

// ---------- export (drafts -> plain object -> YAML text) ----------

function typedDefault(field: FieldDraft): unknown {
  const raw = field.defaultValue.trim();
  if (raw === "") return undefined;
  switch (field.type) {
    case "boolean":
      return raw === "true" ? true : raw === "false" ? false : raw;
    case "number":
    case "integer": {
      const value = Number(raw);
      return Number.isFinite(value) ? value : raw;
    }
    default:
      return field.defaultValue;
  }
}

function fieldToRaw(field: FieldDraft): Record<string, unknown> {
  const out: Record<string, unknown> = { type: field.type };
  const value = typedDefault(field);
  // The compiler treats a field with a default as required unless required: false is written.
  if (value === undefined && field.required) out.required = true;
  if (value !== undefined && !field.required) out.required = false;
  if (field.unique) out.unique = true;
  if (field.index) out.index = true;
  if (field.type === "enum" || field.values.length > 0) out.values = [...field.values];
  if (value !== undefined) out.default = value;
  if (field.type === "relation" || field.to) out.to = field.to;
  if (field.type === "relation" && field.onDelete) out.onDelete = field.onDelete;
  if (field.secret) out.secret = true;
  if (field.writable !== "any") out.writable = field.writable;
  if (field.renameFrom) out.renameFrom = field.renameFrom;
  if (field.description) out.description = field.description;
  return out;
}

function policyValue(list: string[]): string | string[] | undefined {
  const clean = list.map((item) => item.trim()).filter(Boolean);
  if (clean.length === 0) return undefined;
  return clean.length === 1 ? clean[0] : clean;
}

function addressList(value: string): string | string[] | undefined {
  const list = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (list.length === 0) return undefined;
  return list.length === 1 ? list[0] : list;
}

function scalarFor(entity: EntityDraft | undefined, fieldName: string, raw: string): string | number | boolean | null {
  const trimmed = raw.trim();
  if (trimmed === "null") return null;
  const field = entity?.fields.find((item) => item.name === fieldName);
  if (field?.type === "boolean") {
    if (trimmed === "true") return true;
    if (trimmed === "false") return false;
  }
  if (field?.type === "number" || field?.type === "integer") {
    const value = Number(trimmed);
    if (trimmed !== "" && Number.isFinite(value)) return value;
  }
  return trimmed;
}

function whenToRaw(entity: EntityDraft | undefined, item: WhenDraft): unknown {
  const list = () => item.value.split(",").map((part) => scalarFor(entity, item.field, part)).filter((part) => part !== "");
  switch (item.op) {
    case "equals":
      return scalarFor(entity, item.field, item.value);
    case "not":
      return { not: scalarFor(entity, item.field, item.value) };
    case "in":
      return { in: list() };
    case "notIn":
      return { notIn: list() };
    case "exists":
      return { exists: item.value.trim() !== "false" };
    default: {
      const never: never = item.op;
      return never;
    }
  }
}

function mailToRaw(config: BuilderConfig, rule: MailDraft): Record<string, unknown> {
  const entity = config.entities.find((item) => item.name === rule.entity);
  const out: Record<string, unknown> = {};
  if (rule.name) out.name = rule.name;
  out.entity = rule.entity;
  out.events = [...rule.events];
  if (rule.changed.length > 0) out.changed = [...rule.changed];
  if (rule.when.length > 0) {
    const when: Record<string, unknown> = {};
    for (const item of rule.when) when[item.field] = whenToRaw(entity, item);
    out.when = when;
  }
  out.to = addressList(rule.to) ?? "";
  const cc = addressList(rule.cc);
  if (cc !== undefined) out.cc = cc;
  const bcc = addressList(rule.bcc);
  if (bcc !== undefined) out.bcc = bcc;
  if (rule.replyTo.trim()) out.replyTo = rule.replyTo.trim();
  if (rule.subject.trim()) out.subject = rule.subject.trim();
  out.template = rule.template;
  if (rule.expand.length > 0) out.expand = [...rule.expand];
  if (rule.maxAttempts.trim()) {
    const value = Number(rule.maxAttempts);
    out.maxAttempts = Number.isFinite(value) ? value : rule.maxAttempts;
  }
  return out;
}

/** Plain object in app.yaml key order. Duplicate names collapse here, so check builderIssues first. */
export function toAppObject(config: BuilderConfig): Record<string, unknown> {
  const app: Record<string, unknown> = { name: config.app.name };
  if (config.app.version) app.version = config.app.version;
  if (config.app.description) app.description = config.app.description;
  const out: Record<string, unknown> = { app };
  const branding: Record<string, unknown> = {};
  for (const key of BRANDING_KEYS) {
    const value = (config.branding?.[key] ?? "").trim();
    if (value) branding[key] = value;
  }
  if (Object.keys(branding).length > 0) out.branding = branding;
  if (Object.keys(config.runtime).length > 0) out.runtime = config.runtime;
  const auth: Record<string, unknown> = {};
  const a = config.auth;
  if (a.entity) auth.entity = a.entity;
  if (a.identity) auth.identity = a.identity;
  if (a.password) auth.password = a.password;
  if (a.role) auth.role = a.role;
  if (a.adminRole) auth.adminRole = a.adminRole;
  if (a.requireVerifiedEmail || Object.keys(auth).length > 0) auth.requireVerifiedEmail = a.requireVerifiedEmail;
  if (a.signup) auth.signup = a.signup;
  if (Object.keys(auth).length > 0) out.auth = auth;
  const entities: Record<string, unknown> = {};
  for (const entity of config.entities) {
    const raw: Record<string, unknown> = {};
    if (entity.auth) raw.auth = true;
    if (entity.label) raw.label = entity.label;
    if (entity.plural) raw.plural = entity.plural;
    if (entity.display) raw.display = entity.display;
    if (entity.description) raw.description = entity.description;
    const fields: Record<string, unknown> = {};
    for (const field of entity.fields) fields[field.name] = fieldToRaw(field);
    raw.fields = fields;
    const indexes = entity.indexes.filter((item) => item.length > 0);
    if (indexes.length > 0) raw.indexes = indexes.map((item) => [...item]);
    const policies: Record<string, unknown> = {};
    for (const action of POLICY_ACTIONS) {
      const value = policyValue(entity.policies[action]);
      if (value !== undefined) policies[action] = value;
    }
    if (Object.keys(policies).length > 0) raw.policies = policies;
    entities[entity.name] = raw;
  }
  out.entities = entities;
  if (config.webhooks.length > 0) out.webhooks = config.webhooks;
  if (config.mail.length > 0) out.mail = config.mail.map((rule) => mailToRaw(config, rule));
  return out;
}

function isScalarSeq(node: unknown): boolean {
  return isSeq(node) && node.items.every((item) => !isMap(item) && !isSeq(item));
}

/** Render config as app.yaml text in the same compact style as the starters. */
export function toAppYaml(config: BuilderConfig): string {
  const doc = new Document(toAppObject(config));
  // Short lists ([a, b]) and field definitions ({ type: text, required: true }) read best inline.
  visit(doc, {
    Seq(_key, node) {
      if (isScalarSeq(node)) node.flow = true;
    },
    Pair(_key, pair, path) {
      // entities -> <entity> -> fields -> <field>: make each field map inline unless it is long
      const parentMap = path[path.length - 1];
      const fieldsPair = path[path.length - 2];
      if (
        isMap(parentMap) &&
        fieldsPair &&
        typeof fieldsPair === "object" &&
        "key" in fieldsPair &&
        String((fieldsPair as { key: { value?: unknown } }).key?.value) === "fields" &&
        isMap(pair.value)
      ) {
        const text = JSON.stringify((pair.value as YamlNode).toJSON());
        if (text.length <= 110) (pair.value as { flow?: boolean }).flow = true;
      }
    },
  });
  // Blank line before each top-level section and each entity, like the starters.
  const contents = doc.contents;
  if (isMap(contents)) {
    contents.items.forEach((pair, index) => {
      if (index > 0 && pair.key && typeof pair.key === "object") (pair.key as { spaceBefore?: boolean }).spaceBefore = true;
      if (String((pair.key as { value?: unknown })?.value) === "entities" && isMap(pair.value)) {
        pair.value.items.forEach((entityPair, entityIndex) => {
          if (entityIndex > 0 && entityPair.key && typeof entityPair.key === "object") {
            (entityPair.key as { spaceBefore?: boolean }).spaceBefore = true;
          }
        });
      }
    });
  }
  return doc.toString({ lineWidth: 0, flowCollectionPadding: true });
}

// ---------- validation ----------

const ENV_TOKEN = /\$\{([A-Z][A-Z0-9_]*)(:-[^}]*)?\}/g;

/** Env vars referenced without a fallback. The builder fills in placeholders so it can validate. */
export function requiredEnvVars(yamlText: string): string[] {
  const names = new Set<string>();
  for (const match of yamlText.matchAll(ENV_TOKEN)) {
    if (!match[2] && match[1]) names.add(match[1]);
  }
  return [...names].sort();
}

function entityIndex(config: BuilderConfig, name: string): number {
  return config.entities.findIndex((entity) => entity.name === name);
}

function fieldIndex(entity: EntityDraft | undefined, name: string): number {
  return entity ? entity.fields.findIndex((field) => field.name === name) : -1;
}

/** Problems the YAML itself cannot show: duplicate or blank names collapse into one key. */
export function builderIssues(config: BuilderConfig): BuilderIssue[] {
  const issues: BuilderIssue[] = [];
  const error = (target: string, message: string) => issues.push({ target, message, severity: "error" });
  if (!config.app.name.trim()) error("app.name", "App name is required.");
  const seen = new Map<string, number>();
  config.entities.forEach((entity, i) => {
    if (!entity.name.trim()) error(`entities.${i}.name`, "Entity name is required.");
    else if (!IDENT.test(entity.name)) error(`entities.${i}.name`, "Use letters, digits, and underscores, starting with a letter.");
    else if (seen.has(entity.name)) error(`entities.${i}.name`, `Another entity is already named ${entity.name}.`);
    seen.set(entity.name, i);
    const fieldNames = new Set<string>();
    if (entity.fields.length === 0) error(`entities.${i}.fields`, "Add at least one field.");
    entity.fields.forEach((field, j) => {
      const at = `entities.${i}.fields.${j}`;
      if (!field.name.trim()) error(`${at}.name`, "Field name is required.");
      else if (!IDENT.test(field.name)) error(`${at}.name`, "Use letters, digits, and underscores, starting with a letter.");
      else if (["id", "createdAt", "updatedAt"].includes(field.name)) error(`${at}.name`, `${field.name} is added automatically. Pick another name.`);
      else if (fieldNames.has(field.name)) error(`${at}.name`, `Another field in ${entity.name || "this entity"} is named ${field.name}.`);
      fieldNames.add(field.name);
      if (field.type === "enum" && field.values.length === 0) error(`${at}.values`, "List at least one value.");
      if (field.type === "enum") {
        for (const value of field.values) {
          if (!IDENT.test(value)) error(`${at}.values`, `Enum value ${JSON.stringify(value)} must be letters, digits, or underscores.`);
        }
        const def = field.defaultValue.trim();
        if (def && !field.values.includes(def)) error(`${at}.defaultValue`, `Default must be one of ${field.values.join(", ") || "the values"}.`);
      }
      if (field.type === "relation" && !field.to) error(`${at}.to`, "Pick the entity this field points to.");
      if ((field.type === "number" || field.type === "integer") && field.defaultValue.trim()) {
        const value = Number(field.defaultValue);
        if (!Number.isFinite(value) || (field.type === "integer" && !Number.isInteger(value))) {
          error(`${at}.defaultValue`, field.type === "integer" ? "Default must be a whole number." : "Default must be a number.");
        }
      }
    });
    entity.indexes.forEach((index, k) => {
      if (index.length === 0) error(`entities.${i}.indexes.${k}`, "Pick at least one field or remove this index.");
    });
  });
  if (config.entities.length === 0) error("entities", "Add at least one entity.");
  const ruleNames = new Set<string>();
  config.mail.forEach((rule, i) => {
    if (!rule.entity) error(`mail.${i}.entity`, "Pick an entity.");
    if (rule.events.length === 0) error(`mail.${i}.events`, "Pick at least one event.");
    if (!rule.to.trim()) error(`mail.${i}.to`, "Add at least one recipient.");
    if (!rule.template.trim()) error(`mail.${i}.template`, "Name the template file, for example new-lead.");
    if (rule.name && ruleNames.has(rule.name)) error(`mail.${i}.name`, `Another mail rule is named ${rule.name}.`);
    if (rule.name) ruleNames.add(rule.name);
    rule.when.forEach((item, k) => {
      if (!item.field) error(`mail.${i}.when.${k}`, "Pick a field for this condition.");
    });
  });
  return issues;
}

/** Map a Zod issue path (from appYamlSchema) to a form target. */
function zodTarget(config: BuilderConfig, path: Array<string | number>): string {
  const [head, a, b, c, d] = path;
  if (head === "entities" && typeof a === "string") {
    const i = entityIndex(config, a);
    if (i < 0) return "entities";
    if (b === "fields" && typeof c === "string") {
      const j = fieldIndex(config.entities[i], c);
      if (j < 0) return `entities.${i}.fields`;
      if (d === "default") return `entities.${i}.fields.${j}.defaultValue`;
      return d !== undefined ? `entities.${i}.fields.${j}.${String(d)}` : `entities.${i}.fields.${j}.name`;
    }
    if (b === "policies" && typeof c === "string") return `entities.${i}.policies.${c}`;
    if (b === undefined) return `entities.${i}.name`;
    return `entities.${i}.${String(b)}`;
  }
  if (head === "mail" && typeof a === "number") {
    if (b === "when") return `mail.${a}.when`;
    return b !== undefined ? `mail.${a}.${String(b)}` : `mail.${a}`;
  }
  if (head === "app" || head === "auth") return a !== undefined ? `${head}.${String(a)}` : String(head);
  if (head === "runtime") return "runtime";
  if (head === "branding") return a !== undefined ? `branding.${String(a)}` : "branding.name";
  return "";
}

/** Map a compiler (SchemaError) message to a form target, best effort. */
function compileTarget(config: BuilderConfig, message: string): string {
  const text = message.replace(/^app\.yaml:\s*/, "");
  const mail = /^mail rule (?:"([^"]+)"|#(\d+))/.exec(text);
  if (mail) {
    const i = mail[1] !== undefined ? config.mail.findIndex((rule) => rule.name === mail[1]) : Number(mail[2]) - 1;
    if (i < 0) return "mail";
    if (/ entity /.test(text)) return `mail.${i}.entity`;
    if (/expand field/.test(text) || /expand list/.test(text)) return `mail.${i}.expand`;
    if (/changed/.test(text)) return `mail.${i}.changed`;
    if (/when/.test(text)) return `mail.${i}.when`;
    if (/ to:| to /.test(text) && / to(:| )/.test(text.split(":")[0] ?? "")) return `mail.${i}.to`;
    for (const key of ["to", "cc", "bcc", "replyTo", "subject"]) {
      if (text.includes(` ${key}:`)) return `mail.${i}.${key}`;
    }
    if (/name /.test(text)) return `mail.${i}.name`;
    return `mail.${i}`;
  }
  if (/^auth\b/.test(text) || /auth entity|auth: true|auth\.entity/.test(text)) {
    if (/identity/.test(text)) return "auth.identity";
    if (/password/.test(text)) return "auth.password";
    if (/adminRole/.test(text)) return "auth.adminRole";
    if (/role field/.test(text)) return "auth.role";
    return "auth.entity";
  }
  if (/^webhook/.test(text)) return "webhooks";
  const brandingKey = /^branding\.(\w+)/.exec(text);
  if (brandingKey) return `branding.${brandingKey[1]}`;
  if (/^runtime|JWT_SECRET|backup interval|CORS/.test(text)) return "runtime";
  const policy = /^entities\.([A-Za-z_]\w*)\.policies\.(\w+)/.exec(/on (entities\.\S+)/.exec(text)?.[1] ?? "") ??
    /^([A-Za-z_]\w*) policy (\w+):/.exec(text);
  if (policy) {
    const i = entityIndex(config, policy[1]!);
    if (i >= 0) return `entities.${i}.policies.${policy[2]}`;
  }
  const display = /^([A-Za-z_]\w*) display field/.exec(text);
  if (display) {
    const i = entityIndex(config, display[1]!);
    if (i >= 0) return `entities.${i}.display`;
  }
  const index = /^([A-Za-z_]\w*) index references/.exec(text);
  if (index) {
    const i = entityIndex(config, index[1]!);
    if (i >= 0) return `entities.${i}.indexes`;
  }
  const field = /^([A-Za-z_]\w*)\.([A-Za-z_]\w*)\b/.exec(text);
  if (field) {
    const i = entityIndex(config, field[1]!);
    const j = fieldIndex(config.entities[i], field[2]!);
    if (i >= 0 && j >= 0) {
      if (/relat/.test(text)) return `entities.${i}.fields.${j}.to`;
      if (/values/.test(text)) return `entities.${i}.fields.${j}.values`;
      if (/writable|readonly|adminOnly/.test(text)) return `entities.${i}.fields.${j}.writable`;
      return `entities.${i}.fields.${j}.name`;
    }
    if (i >= 0) return `entities.${i}.name`;
  }
  const cycle = /cycle|circular/i.test(text);
  if (cycle) return "entities";
  return "";
}

/**
 * Build the YAML and check it the way the server does at boot:
 * 1. builder-only checks (duplicate names),
 * 2. the server's Zod schema (appYamlSchema),
 * 3. the server's compiler (compileAppYaml), which checks relations, policies, auth, and mail rules.
 */
export function validateConfig(config: BuilderConfig): BuilderResult {
  const yaml = toAppYaml(config);
  const envVars = requiredEnvVars(yaml);
  const mailFiles = [...new Set(config.mail.map((rule) => rule.template.trim()).filter(Boolean))].map(
    (name) => `mail/${name}.html`,
  );
  const brandingFiles = [config.branding?.logo, config.branding?.favicon]
    .map((value) => (value ?? "").trim().replace(/^\.\//, ""))
    .filter(Boolean);
  const issues: BuilderIssue[] = builderIssues(config);
  if (issues.length > 0) return { yaml, issues, mailFiles, envVars, brandingFiles };

  const parsed = appYamlSchema.safeParse(parseYaml(yaml));
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const single = formatZodError({ issues: [issue] } as unknown as Parameters<typeof formatZodError>[0]);
      issues.push({
        target: zodTarget(config, issue.path as Array<string | number>),
        message: single.replace(/^app\.yaml:\s*/, ""),
        severity: "error",
      });
    }
    return { yaml, issues, mailFiles, envVars, brandingFiles };
  }

  let ast: SchemaAST | undefined;
  try {
    const env = Object.fromEntries(envVars.map((name) => [name, `example-${name.toLowerCase()}`]));
    ast = compileAppYaml(yaml, { env, production: false });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    for (const line of message.split("\n").filter((item) => item.trim())) {
      issues.push({ target: compileTarget(config, line), message: line.replace(/^app\.yaml:\s*/, ""), severity: "error" });
    }
    return { yaml, issues, mailFiles, envVars, brandingFiles };
  }

  config.mail.forEach((rule, i) => {
    if (!rule.subject.trim()) {
      issues.push({
        target: `mail.${i}.subject`,
        message: `No subject here, so the server needs mail/${rule.template}.subject at boot.`,
        severity: "warning",
      });
    }
  });
  for (const warning of ast.branding?.warnings ?? []) {
    issues.push({
      target: warning.startsWith("branding.accentColor") ? "branding.accentColor" : "branding.primaryColor",
      message: `This color ${warning.replace(/^branding\.\w+ /, "")} The server adjusts it automatically.`,
      severity: "warning",
    });
  }
  return { yaml, issues, ast, mailFiles, envVars, brandingFiles };
}

/** Rough "is this name usable as an identifier" check for the form. */
export function isIdentifier(value: string): boolean {
  return IDENT.test(value);
}
