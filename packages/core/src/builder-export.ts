// Builder: write the builder model out as an app.yaml object and YAML text.

import { Document, isMap, isSeq, visit, type Node as YamlNode } from "yaml";
import { BRANDING_KEYS, type BuilderConfig, type EntityDraft, entityIndex, type FieldDraft, type JobDraft, type MailDraft, POLICY_ACTIONS, type WhenDraft } from "./builder-model.ts";

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
  if (field.type === "relation" && field.many) out.many = true;
  else if (field.type === "relation" && field.onDelete) out.onDelete = field.onDelete;
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
    const limits: Record<string, unknown> = {};
    for (const action of POLICY_ACTIONS) {
      const rule = entity.rateLimit?.[action];
      if (!rule || rule.limit.trim() === "") continue;
      const limit = Number(rule.limit.trim());
      const windowText = rule.window.trim();
      const out: Record<string, unknown> = {
        limit: Number.isFinite(limit) ? limit : rule.limit.trim(),
        window: /^\d+$/.test(windowText) ? Number(windowText) : windowText,
      };
      if (rule.per) out.per = rule.per;
      limits[action] = out;
    }
    if (Object.keys(limits).length > 0) raw.rateLimit = limits;
    if (entity.realtime === "full") raw.realtime = true;
    else if (entity.realtime === "ids") raw.realtime = "ids";
    entities[entity.name] = raw;
  }
  out.entities = entities;
  if (config.webhooks.length > 0) out.webhooks = config.webhooks;
  if (config.mail.length > 0) out.mail = config.mail.map((rule) => mailToRaw(config, rule));
  if (config.jobs.length > 0) out.jobs = config.jobs.map((job) => jobToRaw(job));
  return out;
}

function jobToRaw(job: JobDraft): Record<string, unknown> {
  const out: Record<string, unknown> = { name: job.name, cron: job.cron };
  if (job.handler && job.handler !== job.name) out.handler = job.handler;
  if (job.timezone && job.timezone !== "UTC") out.timezone = job.timezone;
  if (job.dryRun) out.dryRun = true;
  const timeout = job.timeoutSeconds.trim();
  if (timeout) {
    const value = Number(timeout);
    out.timeoutSeconds = Number.isFinite(value) ? value : timeout;
  }
  if (!job.enabled) out.enabled = false;
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
