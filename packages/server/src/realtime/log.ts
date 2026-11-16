import type { ChangeEvent, ChangeOp, EntityAST, SchemaAST } from "@bakorin/core";
import type { BakorinDb } from "../db/dialects.ts";
import { REALTIME_TABLE } from "../db/system.ts";
import { publicRow } from "../crud/validate.ts";

/** One committed change on a realtime entity. `seq` is the SSE event id. */
export interface RealtimeRow {
  seq: number;
  entity: string;
  op: ChangeOp;
  recordId: string;
  /** Only the id and owner fields: enough to tell who could read the record before. */
  before: Record<string, unknown> | null;
  /** The record without secret fields (full mode), or only id and owner fields (ids mode). */
  after: Record<string, unknown> | null;
  at: number;
}

/** id plus every field named in an owner() read policy. */
export function policyFields(entity: EntityAST): string[] {
  const owners = entity.policies.read.flatMap((policy) => (policy.kind === "owner" ? [policy.field] : []));
  return [...new Set(["id", ...owners])];
}

function pick(row: Record<string, unknown>, fields: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    if (field in row) {
      out[field] = row[field];
    }
  }
  return out;
}

/**
 * Appends a change to the realtime log inside the write's transaction, so the log
 * row exists exactly when the record change commits. No-op for entities without
 * realtime.
 */
export async function appendRealtime(trx: BakorinDb, ast: SchemaAST, event: ChangeEvent): Promise<void> {
  const entity = ast.entityMap[event.entity];
  if (!entity?.realtime) {
    return;
  }
  const fields = policyFields(entity);
  const before = event.before ? pick(event.before, fields) : null;
  const after = event.after ? (entity.realtime === "ids" ? pick(event.after, fields) : publicRow(entity, event.after)) : null;
  const recordId = String(event.after?.id ?? event.before?.id ?? "");
  await trx
    .insertInto(REALTIME_TABLE)
    .values({ entity: entity.name, op: event.op, record_id: recordId, data: JSON.stringify({ before, after }), at: Date.now() })
    .execute();
}

function toRow(raw: Record<string, unknown>): RealtimeRow {
  const data = JSON.parse(String(raw.data)) as { before: RealtimeRow["before"]; after: RealtimeRow["after"] };
  return {
    seq: Number(raw.seq),
    entity: String(raw.entity),
    op: String(raw.op) as ChangeOp,
    recordId: String(raw.record_id),
    before: data.before,
    after: data.after,
    at: Number(raw.at),
  };
}

export async function readRealtimeAfter(db: BakorinDb, seq: number, limit: number): Promise<RealtimeRow[]> {
  const rows = await db
    .selectFrom(REALTIME_TABLE)
    .selectAll()
    .where("seq", ">", seq)
    .orderBy("seq", "asc")
    .limit(limit)
    .execute();
  return rows.map((row) => toRow(row as Record<string, unknown>));
}

export async function realtimeBounds(db: BakorinDb): Promise<{ oldest: number; latest: number }> {
  const row = (await db
    .selectFrom(REALTIME_TABLE)
    .select((eb) => [eb.fn.min("seq").as("oldest"), eb.fn.max("seq").as("latest")])
    .executeTakeFirst()) as { oldest?: unknown; latest?: unknown } | undefined;
  return { oldest: Number(row?.oldest ?? 0), latest: Number(row?.latest ?? 0) };
}

/** Drops log rows older than the retention window, always keeping the newest row so ids keep climbing. */
export async function pruneRealtime(db: BakorinDb, olderThanMs: number): Promise<number> {
  const { latest } = await realtimeBounds(db);
  const result = await db
    .deleteFrom(REALTIME_TABLE)
    .where("at", "<", Date.now() - olderThanMs)
    .where("seq", "<", latest)
    .executeTakeFirst();
  return Number(result.numDeletedRows ?? 0);
}
