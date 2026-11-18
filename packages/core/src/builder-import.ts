// Builder: read an existing app.yaml into the builder model, with warnings for what it cannot keep.

import { parse as parseYaml } from "yaml";
import { BakorinError } from "./errors.ts";
import { BRANDING_KEYS, BUILDER_FIELD_TYPES, type BuilderConfig, type BuilderFieldType, emptyBranding, emptyEntity, emptyField, emptyJob, emptyMailRule, type FieldDraft, MAIL_EVENTS, type MailDraft, ON_DELETE, POLICY_ACTIONS, type WhenDraft } from "./builder-model.ts";

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
  field.defaultValue =
    obj.default === undefined || (obj.default === null && field.type !== "json")
      ? ""
      : field.type === "json"
        ? JSON.stringify(obj.default)
        : str(obj.default);
  field.values = strList(obj.values);
  field.to = str(obj.to);
  field.onDelete = (ON_DELETE as readonly string[]).includes(str(obj.onDelete)) ? (str(obj.onDelete) as FieldDraft["onDelete"]) : "";
  field.many = field.type === "relation" && obj.many === true;
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
  const known = new Set(["app", "branding", "runtime", "auth", "entities", "webhooks", "mail", "jobs"]);
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
    jobs: [],
  };
  for (const [name, rawEntity] of Object.entries(record(root.entities))) {
    const raw = record(rawEntity);
    const entity = emptyEntity(name);
    entity.label = str(raw.label);
    entity.plural = str(raw.plural);
    entity.display = str(raw.display);
    entity.description = str(raw.description);
    entity.auth = raw.auth === true;
    entity.realtime = raw.realtime === true || raw.realtime === "full" ? "full" : raw.realtime === "ids" ? "ids" : "";
    const admin = record(raw.admin);
    entity.admin = {
      group: str(admin.group),
      order: admin.order === undefined ? "" : String(admin.order),
      icon: str(admin.icon),
      hidden: admin.hidden === true,
    };
    entity.fields = Object.entries(record(raw.fields)).map(([fieldName, value]) =>
      fieldFromRaw(fieldName, value, warnings, `entities.${name}.fields.${fieldName}`),
    );
    entity.indexes = (Array.isArray(raw.indexes) ? raw.indexes : []).map((item) => strList(item));
    const policies = record(raw.policies);
    for (const action of POLICY_ACTIONS) entity.policies[action] = strList(policies[action]);
    const limits = record(raw.rateLimit);
    for (const action of POLICY_ACTIONS) {
      const rule = record(limits[action]);
      if (Object.keys(rule).length === 0) continue;
      const per = str(rule.per);
      entity.rateLimit[action] = {
        limit: rule.limit === undefined ? "" : String(rule.limit),
        window: rule.window === undefined ? "" : String(rule.window),
        per: per === "ip" || per === "user" ? per : "",
      };
    }
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
  for (const rawJob of Array.isArray(root.jobs) ? root.jobs : []) {
    const raw = record(rawJob);
    const job = emptyJob(str(raw.name));
    job.cron = str(raw.cron);
    job.handler = str(raw.handler);
    job.timezone = str(raw.timezone);
    job.dryRun = raw.dryRun === true;
    job.timeoutSeconds = raw.timeoutSeconds === undefined ? "" : str(raw.timeoutSeconds);
    job.enabled = raw.enabled !== false;
    config.jobs.push(job);
  }
  return { config, warnings };
}

// ---------- export (drafts -> plain object -> YAML text) ----------
