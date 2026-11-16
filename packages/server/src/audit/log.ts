
import type { BakorinDb } from "../db/dialects.ts";
import { AUDIT_TABLE } from "../db/system.ts";

export interface AuditEntry {
  action: string;
  actorId?: string | null;
  actorRole?: string | null;
  entity?: string | null;
  recordId?: string | null;
  ip?: string | null;
  meta?: Record<string, unknown> | null;
}

export async function writeAudit(db: BakorinDb, entry: AuditEntry): Promise<void> {
  await db
    .insertInto(AUDIT_TABLE)
    .values({
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      action: entry.action,
      actor_id: entry.actorId ?? null,
      actor_role: entry.actorRole ?? null,
      entity: entry.entity ?? null,
      record_id: entry.recordId ?? null,
      ip: entry.ip ?? null,
      meta: entry.meta ? JSON.stringify(entry.meta) : null,
    })
    .execute();
}

export async function listAudit(
  db: BakorinDb,
  options: { limit: number; offset: number },
): Promise<{ rows: Array<Record<string, unknown>>; total: number }> {
  const totalRow = await db.selectFrom(AUDIT_TABLE).select(db.fn.countAll().as("count")).executeTakeFirst();
  const rows = await db
    .selectFrom(AUDIT_TABLE)
    .selectAll()
    .orderBy("at", "desc")
    .limit(options.limit)
    .offset(options.offset)
    .execute();
  return {
    total: Number(totalRow?.count ?? 0),
    rows: rows.map((row) => ({
      id: row.id,
      at: row.at,
      action: row.action,
      actorId: row.actor_id,
      actorRole: row.actor_role,
      entity: row.entity,
      recordId: row.record_id,
      ip: row.ip,
      meta: typeof row.meta === "string" && row.meta ? (JSON.parse(String(row.meta)) as unknown) : null,
    })),
  };
}
