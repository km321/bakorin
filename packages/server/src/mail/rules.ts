import { emailBrand, type EmailBrand } from "../branding/assets.ts";
import type { ChangeEvent, EntityAST, MailConditionAST, MailRuleAST, MailScalar, SchemaAST } from "@bakorin/core";
import type { BakorinDb } from "../db/dialects.ts";
import { decodeRow } from "../crud/query.ts";
import { publicRow } from "../crud/validate.ts";
import { redactRecord } from "../webhooks/redact.ts";

export function mailRules(ast: SchemaAST): MailRuleAST[] {
  return ast.mail ?? [];
}

function normalize(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  return String(value);
}

function sameValue(actual: unknown, expected: MailScalar | undefined, fieldType?: string): boolean {
  if (fieldType === "boolean" && (actual === 0 || actual === 1)) {
    return normalize(actual === 1) === normalize(expected);
  }
  return normalize(actual) === normalize(expected ?? null);
}

export function conditionMatches(
  condition: MailConditionAST,
  record: Record<string, unknown>,
  entity?: EntityAST,
): boolean {
  const value = record[condition.field];
  const type = entity?.fieldMap[condition.field]?.type;
  switch (condition.op) {
    case "equals":
      return sameValue(value, condition.value, type);
    case "not":
      return !sameValue(value, condition.value, type);
    case "in":
      return (condition.values ?? []).some((candidate) => sameValue(value, candidate, type));
    case "notIn":
      return !(condition.values ?? []).some((candidate) => sameValue(value, candidate, type));
    case "exists": {
      const present = value !== null && value !== undefined && value !== "";
      return condition.exists === false ? !present : present;
    }
    default: {
      const exhaustive: never = condition.op;
      return exhaustive;
    }
  }
}

export function ruleMatches(rule: MailRuleAST, event: ChangeEvent, entity?: EntityAST): boolean {
  if (rule.entity !== event.entity || !rule.events.includes(event.op)) {
    return false;
  }
  const record = event.after ?? event.before;
  if (!record) {
    return false;
  }
  if (rule.changed.length > 0) {
    const before = event.before ?? {};
    const changed = rule.changed.some((field) => normalize(before[field]) !== normalize(record[field]));
    if (!changed) {
      return false;
    }
  }
  return rule.when.every((condition) => conditionMatches(condition, record, entity));
}

export function matchingRules(ast: SchemaAST, event: ChangeEvent): MailRuleAST[] {
  const entity = ast.entityMap[event.entity];
  return mailRules(ast).filter((rule) => ruleMatches(rule, event, entity));
}

/**
 * Loads related records for a rule's expand list. This runs in a system context
 * (no read policies), so every related row goes through publicRow, which drops
 * password hashes and fields marked secret.
 */
export async function expandForMail(
  db: BakorinDb,
  ast: SchemaAST,
  entity: EntityAST,
  record: Record<string, unknown> | null,
  fields: string[],
): Promise<Record<string, Record<string, unknown> | null>> {
  const out: Record<string, Record<string, unknown> | null> = {};
  for (const name of fields) {
    out[name] = null;
    const target = entity.fieldMap[name]?.relation?.to;
    const targetEntity = target ? ast.entityMap[target] : undefined;
    const id = record?.[name];
    if (!target || !targetEntity || (typeof id !== "string" && typeof id !== "number")) {
      continue;
    }
    const row = await db.selectFrom(target).selectAll().where("id", "=", String(id)).executeTakeFirst();
    if (row) {
      out[name] = publicRow(targetEntity, decodeRow(targetEntity, row as Record<string, unknown>));
    }
  }
  return out;
}

export interface MailAppInfo {
  name: string;
  url: string;
}

export function appInfo(ast: SchemaAST): MailAppInfo {
  return { name: ast.appName, url: ast.runtime.appUrl };
}

/** {{ brand.name }}, {{ brand.primary }}, {{ brand.logoUrl }} for templates, only when app.yaml has branding. */
export function brandData(ast: SchemaAST): { brand?: EmailBrand } {
  const brand = emailBrand(ast);
  return brand ? { brand } : {};
}

export async function buildRuleData(
  db: BakorinDb,
  ast: SchemaAST,
  rule: Pick<MailRuleAST, "expand">,
  event: Pick<ChangeEvent, "entity" | "op" | "before" | "after">,
): Promise<Record<string, unknown>> {
  const entity = ast.entityMap[event.entity];
  const raw = event.after ?? event.before;
  const record = redactRecord(entity, raw);
  const before = event.op === "update" ? redactRecord(entity, event.before) : null;
  const expand = entity ? await expandForMail(db, ast, entity, raw, rule.expand) : {};
  return {
    record,
    before,
    expand,
    event: { entity: event.entity, op: event.op },
    app: appInfo(ast),
    ...brandData(ast),
  };
}

const SAMPLE_ID = "00000000-0000-4000-8000-000000000000";

/** A plausible record for previews when no real record is chosen. Never includes secret fields. */
export function sampleRecord(entity: EntityAST): Record<string, unknown> {
  const now = new Date().toISOString();
  const out: Record<string, unknown> = {};
  for (const field of entity.fields) {
    if (field.secret || field.type === "password") {
      continue;
    }
    if (field.name === "id") {
      out.id = SAMPLE_ID;
      continue;
    }
    if (field.name === "createdAt" || field.name === "updatedAt") {
      out[field.name] = now;
      continue;
    }
    if (field.defaultValue !== undefined && field.defaultValue !== null) {
      out[field.name] = field.defaultValue;
      continue;
    }
    switch (field.type) {
      case "boolean":
        out[field.name] = true;
        break;
      case "number":
        out[field.name] = 49.5;
        break;
      case "integer":
        out[field.name] = 3;
        break;
      case "email":
        out[field.name] = "customer@example.com";
        break;
      case "enum":
        out[field.name] = field.enumValues?.[0] ?? "sample";
        break;
      case "date":
        out[field.name] = now.slice(0, 10);
        break;
      case "datetime":
        out[field.name] = now;
        break;
      case "relation":
        out[field.name] = SAMPLE_ID;
        break;
      case "file":
        out[field.name] = null;
        break;
      case "text":
        out[field.name] = `Sample ${field.name}`;
        break;
      default:
        out[field.name] = null;
    }
  }
  return out;
}

export function sampleRuleData(ast: SchemaAST, entityName: string, expandFields: string[]): Record<string, unknown> {
  const entity = ast.entityMap[entityName];
  const record = entity ? sampleRecord(entity) : {};
  const expand: Record<string, Record<string, unknown> | null> = {};
  for (const name of expandFields) {
    const target = entity?.fieldMap[name]?.relation?.to;
    const targetEntity = target ? ast.entityMap[target] : undefined;
    expand[name] = targetEntity ? sampleRecord(targetEntity) : null;
  }
  return {
    record,
    before: record,
    expand,
    event: { entity: entityName, op: "create" },
    app: appInfo(ast),
    ...brandData(ast),
    sample: true,
  };
}
