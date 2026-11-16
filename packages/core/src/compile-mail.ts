/** Mail rules in app.yaml and checks on their template placeholders. */

import { SchemaError } from "./errors.ts";
import type { AppYaml } from "./yaml-schema.ts";
import { type EntityAST, MAIL_DEFAULT_MAX_ATTEMPTS, type MailConditionAST, type MailRuleAST } from "./ast.ts";

const MAIL_TEMPLATE_TOKEN = /\{\{\{?\s*([^}]*?)\s*\}?\}\}/g;
const MAIL_ROOTS = new Set(["record", "before", "expand", "event", "app"]);

function listOf(value: string | string[] | undefined): string[] {
  if (value === undefined) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function checkMailPlaceholders(label: string, value: string, expand: string[], entity: EntityAST): void {
  for (const match of value.matchAll(MAIL_TEMPLATE_TOKEN)) {
    const path = (match[1] ?? "").trim();
    if (match[0].startsWith("{{{")) {
      throw new SchemaError(`${label}: raw {{{ }}} output is not allowed here, use {{ ${path} }}`);
    }
    if (path.startsWith("#") || path.startsWith("/") || path === "else") {
      throw new SchemaError(`${label}: blocks like {{#if}} are only allowed in template files`);
    }
    const parts = path.split(".");
    const root = parts[0] ?? "";
    if (!MAIL_ROOTS.has(root)) {
      throw new SchemaError(
        `${label}: {{ ${path} }} must start with record, before, expand, event, or app`,
      );
    }
    if ((root === "record" || root === "before") && parts[1] && !entity.fieldMap[parts[1]]) {
      throw new SchemaError(`${label}: {{ ${path} }} references unknown field ${entity.name}.${parts[1]}`);
    }
    if (root === "expand" && parts[1] && !expand.includes(parts[1])) {
      throw new SchemaError(`${label}: {{ ${path} }} needs "${parts[1]}" in the rule's expand list`);
    }
  }
}

export function compileMailRules(yaml: AppYaml, entityMap: Record<string, EntityAST>): MailRuleAST[] {
  const seen = new Set<string>();
  return (yaml.mail ?? []).map((rule, index) => {
    const id = rule.name ?? `mail_${index + 1}`;
    const label = `mail rule ${rule.name ? `"${rule.name}"` : `#${index + 1}`}`;
    if (seen.has(id)) {
      throw new SchemaError(`${label}: name ${id} is used by more than one mail rule`);
    }
    seen.add(id);
    const entity = entityMap[rule.entity];
    if (!entity) {
      const known = Object.keys(entityMap).join(", ");
      throw new SchemaError(`${label}: entity ${rule.entity} does not exist (known entities: ${known})`);
    }
    const expand = rule.expand ?? [];
    for (const name of expand) {
      const field = entity.fieldMap[name];
      if (!field) {
        throw new SchemaError(`${label}: expand field ${entity.name}.${name} does not exist`);
      }
      if (!field.relation) {
        throw new SchemaError(`${label}: expand field ${entity.name}.${name} must be a relation field`);
      }
    }
    const changed = rule.changed ?? [];
    for (const name of changed) {
      if (!entity.fieldMap[name]) {
        throw new SchemaError(`${label}: changed field ${entity.name}.${name} does not exist`);
      }
    }
    if (changed.length > 0 && (rule.events.length !== 1 || rule.events[0] !== "update")) {
      throw new SchemaError(`${label}: changed only works with events: [update]`);
    }
    const when: MailConditionAST[] = [];
    for (const [field, condition] of Object.entries(rule.when ?? {})) {
      const target = entity.fieldMap[field];
      if (!target) {
        throw new SchemaError(`${label}: when field ${entity.name}.${field} does not exist`);
      }
      if (target.secret || target.type === "password") {
        throw new SchemaError(`${label}: when cannot test secret field ${entity.name}.${field}`);
      }
      if (condition === null || typeof condition !== "object") {
        when.push({ field, op: "equals", value: condition });
        continue;
      }
      const ops = Object.keys(condition);
      if (ops.length !== 1) {
        throw new SchemaError(`${label}: when.${field} must use exactly one of equals, not, in, notIn, or exists`);
      }
      if (condition.in) {
        when.push({ field, op: "in", values: condition.in });
      } else if (condition.notIn) {
        when.push({ field, op: "notIn", values: condition.notIn });
      } else if (condition.exists !== undefined) {
        when.push({ field, op: "exists", exists: condition.exists });
      } else if ("not" in condition) {
        when.push({ field, op: "not", value: condition.not ?? null });
      } else {
        when.push({ field, op: "equals", value: condition.equals ?? null });
      }
    }
    const to = listOf(rule.to);
    const cc = listOf(rule.cc);
    const bcc = listOf(rule.bcc);
    for (const [key, values] of [["to", to], ["cc", cc], ["bcc", bcc]] as const) {
      for (const value of values) {
        checkMailPlaceholders(`${label} ${key}`, value, expand, entity);
      }
    }
    if (rule.replyTo) {
      checkMailPlaceholders(`${label} replyTo`, rule.replyTo, expand, entity);
    }
    if (rule.subject) {
      checkMailPlaceholders(`${label} subject`, rule.subject, expand, entity);
    }
    return {
      id,
      entity: entity.name,
      events: rule.events,
      to,
      cc,
      bcc,
      replyTo: rule.replyTo,
      subject: rule.subject,
      template: rule.template,
      when,
      changed,
      expand,
      maxAttempts: rule.maxAttempts ?? MAIL_DEFAULT_MAX_ATTEMPTS,
    };
  });
}
