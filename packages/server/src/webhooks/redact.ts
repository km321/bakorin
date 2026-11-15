import type { ChangeEvent, EntityAST, SchemaAST } from "@bakorin/core";
import { publicRow } from "../crud/validate.ts";

function stripFallbackSecrets(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (key === "password") {
      continue;
    }
    out[key] = value;
  }
  return out;
}

export function redactRecord(entity: EntityAST | undefined, row: Record<string, unknown> | null): Record<string, unknown> | null {
  if (row == null) {
    return null;
  }
  if (!entity) {
    return stripFallbackSecrets(row);
  }
  return publicRow(entity, row);
}

export function redactActor(actor: ChangeEvent["actor"]): ChangeEvent["actor"] {
  if (!actor) {
    return null;
  }
  return { id: actor.id, role: actor.role };
}

export function redactChangeEvent(ast: SchemaAST, event: ChangeEvent): ChangeEvent {
  const entity = ast.entityMap[event.entity];
  return {
    entity: event.entity,
    op: event.op,
    before: redactRecord(entity, event.before),
    after: redactRecord(entity, event.after),
    actor: redactActor(event.actor),
  };
}

export function payloadContainsSecret(ast: SchemaAST, payload: unknown): boolean {
  if (!payload || typeof payload !== "object") {
    return false;
  }
  const body = payload as { entity?: unknown; before?: unknown; after?: unknown };
  const entityName = typeof body.entity === "string" ? body.entity : "";
  const entity = ast.entityMap[entityName];
  const secretNames = new Set(
    (entity?.fields ?? []).filter((field) => field.secret).map((field) => field.name),
  );
  secretNames.add("password");
  for (const record of [body.before, body.after]) {
    if (!record || typeof record !== "object") {
      continue;
    }
    for (const key of Object.keys(record as Record<string, unknown>)) {
      if (secretNames.has(key)) {
        return true;
      }
    }
  }
  return false;
}
