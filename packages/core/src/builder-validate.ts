// Builder: field level issues and full validation through the same schema and compiler the server runs.

import { parse as parseYaml } from "yaml";
import type { SchemaAST } from "./ast.ts";
import { compileAppYaml } from "./compile.ts";
import { formatZodError } from "./format-schema.ts";
import { appYamlSchema } from "./yaml-schema.ts";
import { requiredEnvVars, toAppYaml } from "./builder-export.ts";
import { type BuilderConfig, type BuilderIssue, type BuilderResult, entityIndex, fieldIndex } from "./builder-model.ts";

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

// ---------- constructors ----------

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
      if (field.type === "json") {
        if (field.unique || field.index) error(`${at}.type`, "JSON fields cannot be unique or indexed.");
        const def = field.defaultValue.trim();
        if (def) {
          try {
            JSON.parse(def);
          } catch {
            error(`${at}.defaultValue`, "Default must be valid JSON, for example {} or [].");
          }
        }
      }
      if (field.type === "richtext" && field.unique) error(`${at}.type`, "Rich text fields cannot be unique.");
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
    const admin = entity.admin;
    if (admin) {
      const order = admin.order.trim();
      if (order && (!/^-?\d+$/.test(order) || Math.abs(Number(order)) > 1000)) error(`entities.${i}.admin.order`, "Order must be a whole number from -1000 to 1000.");
      if ([...admin.icon.trim()].length > 2) error(`entities.${i}.admin.icon`, "Use 1 or 2 characters.");
      if (admin.group.trim().length > 40) error(`entities.${i}.admin.group`, "Keep the group name to 40 characters.");
    }
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
  if (head === "jobs" && typeof a === "number") {
    return b !== undefined ? `jobs.${a}.${String(b)}` : `jobs.${a}`;
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
  const job = /^job (?:"([^"]+)"|#(\d+))/.exec(text);
  if (job) {
    const i = job[1] !== undefined ? config.jobs.findIndex((item) => item.name === job[1]) : Number(job[2]) - 1;
    if (i < 0) return "jobs";
    if (/cron/.test(text)) return `jobs.${i}.cron`;
    if (/handler/.test(text)) return `jobs.${i}.handler`;
    if (/timezone/.test(text)) return `jobs.${i}.timezone`;
    if (/timeoutSeconds/.test(text)) return `jobs.${i}.timeoutSeconds`;
    if (/name /.test(text)) return `jobs.${i}.name`;
    return `jobs.${i}`;
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

  const parsed = appYamlSchema.safeParse(parseYaml(yaml), { reportInput: true });
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
