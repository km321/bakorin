import { DiffAbortError } from "./errors.ts";
import type { EntityAST, FieldAST, FieldTypeName, SchemaAST } from "./ast.ts";

export type DiffTier = "auto" | "safe" | "deprecate" | "abort";

export type DiffChange =
  | { tier: "auto"; kind: "add_entity"; entity: EntityAST }
  | { tier: "auto"; kind: "add_field"; entity: string; field: FieldAST }
  | { tier: "auto"; kind: "add_index"; entity: string; field: string }
  | { tier: "safe"; kind: "rename_entity"; from: string; to: string }
  | { tier: "safe"; kind: "rename_field"; entity: string; from: string; to: string }
  | { tier: "deprecate"; kind: "drop_entity"; entity: string }
  | { tier: "deprecate"; kind: "drop_field"; entity: string; field: string }
  | { tier: "abort"; kind: "breaking"; message: string };

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

function enumOnlyAdded(from: FieldAST, to: FieldAST): boolean {
  if (from.type !== "enum" || to.type !== "enum") {
    return false;
  }
  const oldValues = new Set(from.enumValues ?? []);
  return (to.enumValues ?? []).every((value) => oldValues.has(value)) === false
    ? (from.enumValues ?? []).every((value) => (to.enumValues ?? []).includes(value))
    : from.enumValues?.join() === to.enumValues?.join();
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
    const renameFrom = next.fields.find((field) => field.renameFrom && field.renameFrom === next.name);
    void renameFrom;
    let prev = fromEntities.get(next.name);
    if (!prev) {
      const renamed = from.entities.find((candidate) => {
        if (consumedFrom.has(candidate.name)) {
          return false;
        }
        const overlap = candidate.fields.filter((field) => next.fieldMap[field.name] || next.fields.some((n) => n.renameFrom === field.name));
        return overlap.length >= Math.min(2, candidate.fields.length) && candidate.auth === next.auth;
      });
      if (renamed && next.fields.some((field) => field.renameFrom)) {
        // entity rename is only explicit via matching renameFrom on a sentinel; keep entity names stable in v0.1
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

  return plan;
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
}

function compareField(entity: string, from: FieldAST, to: FieldAST, plan: DiffPlan): void {
  if (from.type !== to.type && !typeCompatible(from, to)) {
    plan.abort.push({
      tier: "abort",
      kind: "breaking",
      message: `cannot change ${entity}.${from.name} from ${from.type} to ${to.type}`,
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
    if (removed.length > 0 && !enumOnlyAdded(from, to)) {
      plan.abort.push({
        tier: "abort",
        kind: "breaking",
        message: `cannot remove enum values ${removed.join(", ")} from ${entity}.${from.name}`,
      });
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
    plan.auto.push({ tier: "auto", kind: "add_index", entity, field: to.name });
  }
}

export function assertPlanApplyable(plan: DiffPlan): void {
  if (plan.abort.length > 0) {
    const messages = plan.abort.map((change) => (change.kind === "breaking" ? change.message : change.kind));
    throw new DiffAbortError(`schema changes abort because they are breaking:\n- ${messages.join("\n- ")}`, messages);
  }
}
