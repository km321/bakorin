import { DiffAbortError } from "./errors.ts";
import type { EntityAST, FieldAST, FieldTypeName, SchemaAST } from "./ast.ts";

export type DiffTier = "auto" | "safe" | "deprecate" | "abort";

export type DiffChange =
  | { tier: "auto"; kind: "add_entity"; entity: EntityAST }
  | { tier: "auto"; kind: "add_field"; entity: string; field: FieldAST }
  | { tier: "auto"; kind: "add_index"; entity: string; fields: string[] }
  | { tier: "safe"; kind: "rename_entity"; from: string; to: string }
  | { tier: "safe"; kind: "rename_field"; entity: string; from: string; to: string }
  | { tier: "deprecate"; kind: "drop_entity"; entity: string; hint?: string }
  | { tier: "deprecate"; kind: "drop_field"; entity: string; field: string; hint?: string }
  | { tier: "deprecate"; kind: "remove_enum_values"; entity: string; field: string; values: string[] }
  | { tier: "abort"; kind: "breaking"; message: string };

/**
 * auto: additive, applied on boot.
 * safe: renames declared with renameFrom, applied on boot after an automatic backup.
 * deprecate: removals (drop an entity or field, remove enum values). Data stays in the
 *   database, but the API stops serving it, so these need explicit confirmation.
 * abort: changes the migrator cannot do without losing or corrupting data.
 */
export interface DiffPlan {
  auto: DiffChange[];
  safe: DiffChange[];
  deprecate: DiffChange[];
  abort: DiffChange[];
}

const WIDENING: Record<FieldTypeName, FieldTypeName[]> = {
  text: ["text", "email"],
  email: ["email", "text"],
  password: ["password"],
  number: ["number"],
  integer: ["integer", "number"],
  boolean: ["boolean"],
  date: ["date", "datetime"],
  datetime: ["datetime"],
  enum: ["enum"],
  file: ["file"],
  relation: ["relation"],
};

function fieldMapByRename(entity: EntityAST): Map<string, FieldAST> {
  const map = new Map<string, FieldAST>();
  for (const field of entity.fields) {
    map.set(field.name, field);
    if (field.renameFrom) {
      map.set(field.renameFrom, field);
    }
  }
  return map;
}

function isAdditiveField(field: FieldAST): boolean {
  return !field.required || field.defaultValue !== undefined || field.name === "id";
}

function typeCompatible(from: FieldAST, to: FieldAST): boolean {
  if (from.type !== to.type) {
    return (WIDENING[from.type] ?? []).includes(to.type);
  }
  if (from.type === "relation") {
    return from.relation?.to === to.relation?.to;
  }
  if (from.type === "enum") {
    const oldValues = new Set(from.enumValues ?? []);
    return (to.enumValues ?? []).every((value) => oldValues.has(value))
      ? true
      : (from.enumValues ?? []).every((value) => (to.enumValues ?? []).includes(value));
  }
  return true;
}

export function diffSchemas(from: SchemaAST | null, to: SchemaAST): DiffPlan {
  const plan: DiffPlan = { auto: [], safe: [], deprecate: [], abort: [] };
  if (!from) {
    for (const name of to.order) {
      const entity = to.entityMap[name];
      if (entity) {
        plan.auto.push({ tier: "auto", kind: "add_entity", entity });
      }
    }
    return plan;
  }

  const fromEntities = new Map(from.entities.map((entity) => [entity.name, entity]));
  const toEntities = new Map(to.entities.map((entity) => [entity.name, entity]));
  const consumedFrom = new Set<string>();

  for (const next of to.entities) {
    let prev = fromEntities.get(next.name);
    if (!prev && next.renameFrom) {
      const old = fromEntities.get(next.renameFrom);
      if (old && !toEntities.has(old.name) && !consumedFrom.has(old.name)) {
        plan.safe.push({ tier: "safe", kind: "rename_entity", from: old.name, to: next.name });
        prev = old;
      }
    }
    if (!prev) {
      plan.auto.push({ tier: "auto", kind: "add_entity", entity: next });
      continue;
    }
    consumedFrom.add(prev.name);
    diffEntity(prev, next, plan);
  }

  for (const prev of from.entities) {
    if (!consumedFrom.has(prev.name) && !toEntities.has(prev.name)) {
      plan.deprecate.push({ tier: "deprecate", kind: "drop_entity", entity: prev.name });
    }
  }

  addRenameHints(plan);
  return plan;
}

/** A dropped field next to an added field of the same type is often an undeclared rename. */
function addRenameHints(plan: DiffPlan): void {
  for (const change of plan.deprecate) {
    if (change.kind !== "drop_field") {
      continue;
    }
    const added = plan.auto.find((item) => item.kind === "add_field" && item.entity === change.entity);
    if (added && added.kind === "add_field") {
      change.hint = `if ${change.entity}.${added.field.name} is ${change.field} renamed, add renameFrom: ${change.field} to it instead`;
    }
  }
  for (const change of plan.deprecate) {
    if (change.kind !== "drop_entity") {
      continue;
    }
    const added = plan.auto.find((item) => item.kind === "add_entity");
    if (added && added.kind === "add_entity") {
      change.hint = `if ${added.entity.name} is ${change.entity} renamed, add renameFrom: ${change.entity} to the entity instead`;
    }
  }
}

/** Plain-language line for a change, used by the CLI plan and boot errors. */
export function describeChange(change: DiffChange): string {
  switch (change.kind) {
    case "add_entity":
      return `add entity ${change.entity.name}`;
    case "add_field":
      return `add field ${change.entity}.${change.field.name} (${change.field.type}${change.field.relation?.many ? ", many" : ""})`;
    case "add_index":
      return `add index on ${change.entity} (${change.fields.join(", ")})`;
    case "rename_entity":
      return `rename entity ${change.from} to ${change.to}`;
    case "rename_field":
      return `rename field ${change.entity}.${change.from} to ${change.entity}.${change.to}`;
    case "drop_entity":
      return `remove entity ${change.entity} (the table stays in the database but the API stops serving it)`;
    case "drop_field":
      return `remove field ${change.entity}.${change.field} (the column stays in the database but the API stops serving it)`;
    case "remove_enum_values":
      return `remove enum values ${change.values.join(", ")} from ${change.entity}.${change.field} (existing rows keep them)`;
    case "breaking":
      return change.message;
    default: {
      const _never: never = change;
      return String(_never);
    }
  }
}

/** True when applying the plan needs an explicit confirmation. */
export function needsConfirmation(plan: DiffPlan): boolean {
  return plan.deprecate.length > 0;
}

/** True when the plan changes existing tables (renames or removals), so a backup is taken first. */
export function touchesExistingData(plan: DiffPlan): boolean {
  return plan.safe.length > 0 || plan.deprecate.length > 0;
}

/**
 * Short code that names exactly this set of destructive changes. Confirming with
 * the code means a stale confirmation cannot approve a different change later.
 */
export function destructiveCode(plan: DiffPlan): string {
  const text = plan.deprecate.map((change) => describeChange(change)).sort().join("\n");
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/** Readable multi-line plan for the CLI and logs. */
export function formatPlan(plan: DiffPlan): string {
  const lines: string[] = [];
  const section = (title: string, changes: DiffChange[]) => {
    if (changes.length === 0) {
      return;
    }
    lines.push(title);
    for (const change of changes) {
      lines.push(`  - ${describeChange(change)}`);
      const hint = (change as { hint?: string }).hint;
      if (hint) {
        lines.push(`    hint: ${hint}`);
      }
    }
  };
  section("Additive, applied automatically:", plan.auto);
  section("Renames declared with renameFrom, applied automatically after a backup:", plan.safe);
  section("Removals, need confirmation:", plan.deprecate);
  section("Blocked, cannot be applied without losing data:", plan.abort);
  if (lines.length === 0) {
    lines.push("No schema changes.");
  }
  return lines.join("\n");
}

function diffEntity(prev: EntityAST, next: EntityAST, plan: DiffPlan): void {
  const prevFields = new Map(prev.fields.map((field) => [field.name, field]));
  const matchedPrev = new Set<string>();
  const nextByRename = fieldMapByRename(next);

  for (const field of next.fields) {
    if (field.name === "id" || field.name === "createdAt" || field.name === "updatedAt") {
      const existing = prevFields.get(field.name);
      if (existing) {
        matchedPrev.add(field.name);
      }
      continue;
    }
    let oldField = prevFields.get(field.name);
    if (!oldField && field.renameFrom) {
      oldField = prevFields.get(field.renameFrom);
      if (oldField) {
        plan.safe.push({
          tier: "safe",
          kind: "rename_field",
          entity: next.name,
          from: oldField.name,
          to: field.name,
        });
        matchedPrev.add(oldField.name);
        compareField(next.name, oldField, field, plan);
        continue;
      }
      plan.abort.push({
        tier: "abort",
        kind: "breaking",
        message: `${next.name}.${field.name} renameFrom ${field.renameFrom} does not exist on the current schema`,
      });
      continue;
    }
    if (!oldField) {
      if (!isAdditiveField(field)) {
        plan.abort.push({
          tier: "abort",
          kind: "breaking",
          message: `cannot add required field ${next.name}.${field.name} without a default`,
        });
        continue;
      }
      plan.auto.push({ tier: "auto", kind: "add_field", entity: next.name, field });
      continue;
    }
    matchedPrev.add(oldField.name);
    compareField(next.name, oldField, field, plan);
  }

  for (const oldField of prev.fields) {
    if (oldField.name === "id" || oldField.name === "createdAt" || oldField.name === "updatedAt") {
      continue;
    }
    if (!matchedPrev.has(oldField.name) && !nextByRename.has(oldField.name)) {
      plan.deprecate.push({ tier: "deprecate", kind: "drop_field", entity: next.name, field: oldField.name });
    }
  }

  const prevKeys = new Set((prev.indexes ?? []).map((fields) => fields.join(",")));
  for (const fields of next.indexes ?? []) {
    const key = fields.join(",");
    if (!prevKeys.has(key)) {
      plan.auto.push({ tier: "auto", kind: "add_index", entity: next.name, fields });
    }
  }
}

function compareField(entity: string, from: FieldAST, to: FieldAST, plan: DiffPlan): void {
  if (from.type !== to.type && !typeCompatible(from, to)) {
    plan.abort.push({
      tier: "abort",
      kind: "breaking",
      message: `cannot change ${entity}.${from.name} from ${from.type} to ${to.type}. Add a new field, copy the data in a hook or script, then remove the old one`,
    });
    return;
  }
  if (from.type === "relation" && to.type === "relation" && Boolean(from.relation?.many) !== Boolean(to.relation?.many)) {
    plan.abort.push({
      tier: "abort",
      kind: "breaking",
      message: `cannot switch ${entity}.${from.name} between a single relation and many: true. Add a new field, copy the links in a script, then remove the old one`,
    });
    return;
  }
  if (from.type === "relation" && to.type === "relation" && from.relation?.to !== to.relation?.to) {
    plan.abort.push({
      tier: "abort",
      kind: "breaking",
      message: `cannot retarget relation ${entity}.${from.name} from ${from.relation?.to} to ${to.relation?.to}`,
    });
  }
  if (from.type === "enum" && to.type === "enum") {
    const removed = (from.enumValues ?? []).filter((value) => !(to.enumValues ?? []).includes(value));
    if (removed.length > 0) {
      plan.deprecate.push({ tier: "deprecate", kind: "remove_enum_values", entity, field: to.name, values: removed });
    }
  }
  if (!from.unique && to.unique) {
    plan.abort.push({
      tier: "abort",
      kind: "breaking",
      message: `cannot add unique to existing field ${entity}.${from.name} (may fail on existing rows)`,
    });
  }
  if (!from.required && to.required && to.defaultValue === undefined) {
    plan.abort.push({
      tier: "abort",
      kind: "breaking",
      message: `cannot make ${entity}.${from.name} required without a default`,
    });
  }
  if (!from.indexed && to.indexed) {
    plan.auto.push({ tier: "auto", kind: "add_index", entity, fields: [to.name] });
  }
}

export function assertPlanApplyable(plan: DiffPlan): void {
  if (plan.abort.length > 0) {
    const messages = plan.abort.map((change) => (change.kind === "breaking" ? change.message : change.kind));
    throw new DiffAbortError(`schema changes abort because they are breaking:\n- ${messages.join("\n- ")}`, messages);
  }
}
