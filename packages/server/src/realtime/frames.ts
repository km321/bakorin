/** Server sent event frames and who may see them: per actor visibility, grouping, and encoding. */

import type { EntityAST, SchemaAST } from "@bakorin/core";
import type { Actor } from "../context.ts";
import { decideAccess } from "../crud/policies-sql.ts";
import { visibleRow } from "../crud/validate.ts";
import type { RealtimeRow } from "./log.ts";

export const encoder = new TextEncoder();
export const PING = encoder.encode(": ping\n\n");

export function json(status: number, code: string, message: string, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...headers },
  });
}

export function concat(chunks: Uint8Array[]): Uint8Array {
  let length = 0;
  for (const chunk of chunks) length += chunk.byteLength;
  const out = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

const policyShapes = new WeakMap<EntityAST, { isPublic: boolean; byRole: boolean; byOwner: boolean }>();

export function policyShape(entity: EntityAST) {
  let shape = policyShapes.get(entity);
  if (!shape) {
    const read = entity.policies.read;
    shape = {
      isPublic: read.some((policy) => policy.kind === "public"),
      byRole: read.some((policy) => policy.kind === "role"),
      byOwner: read.some((policy) => policy.kind === "owner"),
    };
    policyShapes.set(entity, shape);
  }
  return shape;
}

/**
 * Subscribers whose key matches see exactly the same bytes for a given event, so
 * the frame is built once per key and shared. Public read entities collapse to one
 * key for everyone who is not an admin.
 */
export function groupKey(
  ast: SchemaAST,
  entity: EntityAST,
  actor: Actor | null,
  recordId: string,
  shape = policyShape(entity),
): string {
  if (actor && actor.role === ast.auth.adminRole) {
    return "a";
  }
  const self = actor && recordId === actor.id && entity.name === ast.auth.entity;
  if (shape.isPublic) {
    return self ? "p:self" : "p";
  }
  if (!actor) {
    return "x";
  }
  let key = "u";
  if (shape.byRole) key += `:${actor.role}`;
  if (shape.byOwner) key += `:${actor.id}`;
  return self ? `${key}:self` : key;
}

function readable(ast: SchemaAST, entity: EntityAST, actor: Actor | null, record: Record<string, unknown> | null): boolean {
  if (!record) {
    return false;
  }
  const decision = decideAccess(ast, entity, "read", actor);
  if (!decision.allow) {
    return false;
  }
  if (decision.bypass || decision.ownerFields.length === 0) {
    return true;
  }
  return decision.ownerFields.some((field) => actor !== null && String(record[field] ?? "") === actor.id);
}

/** The SSE frame one reader gets for a change, or null when they may not see it. */
export function buildFrame(ast: SchemaAST, entity: EntityAST, row: RealtimeRow, actor: Actor | null): Uint8Array | null {
  const canAfter = row.op !== "delete" && readable(ast, entity, actor, row.after);
  const canBefore = row.op !== "create" && readable(ast, entity, actor, row.before);
  let op: "create" | "update" | "delete";
  if (row.op === "create") {
    if (!canAfter) return null;
    op = "create";
  } else if (row.op === "update") {
    if (canAfter) op = "update";
    else if (canBefore) op = "delete"; // the record left this reader's view
    else return null;
  } else {
    if (!canBefore) return null;
    op = "delete";
  }
  const payload: Record<string, unknown> = { entity: entity.name, op, id: row.recordId, at: row.at };
  if (op !== "delete" && entity.realtime === "full" && row.after) {
    const record = visibleRow(ast, entity, row.after, actor);
    // Linked ids are only sent when anyone may read the linked entity (or to
    // admins). Otherwise the field is left out and clients refetch the record,
    // which filters ids per reader. Keeps one shared frame per policy group.
    if (!(actor && actor.role === ast.auth.adminRole)) {
      for (const field of entity.fields) {
        if (!field.relation?.many) continue;
        const target = ast.entityMap[field.relation.to];
        if (!target?.policies.read.some((policy) => policy.kind === "public")) delete record[field.name];
      }
    }
    payload.record = record;
  }
  return encoder.encode(`id: ${row.seq}\nevent: change\ndata: ${JSON.stringify(payload)}\n\n`);
}

export function frame(event: string, data: unknown, extra = ""): Uint8Array {
  return encoder.encode(`${extra}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}
