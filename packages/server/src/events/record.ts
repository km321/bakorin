import type { ChangeEvent, SchemaAST } from "@bakorin/core";
import type { AppContext } from "../context.ts";
import type { ChangeMeta } from "../bus.ts";
import type { BakorinDb } from "../db/dialects.ts";
import { writeAudit, type AuditEntry } from "../audit/log.ts";
import { enqueueWebhook, matchingHooks } from "../webhooks/dispatcher.ts";
import { enqueueRuleMail } from "../mail/outbox.ts";
import { matchingRules } from "../mail/rules.ts";
import { appendRealtime } from "../realtime/log.ts";

/** The audit row a change needs: admin writes and role changes. Null otherwise. */
export function auditEntryFor(ast: SchemaAST, event: ChangeEvent, meta: ChangeMeta = {}): AuditEntry | null {
  const admin = event.actor?.role === ast.auth.adminRole;
  const roleChanged =
    event.entity === ast.auth.entity &&
    event.op === "update" &&
    event.before !== null &&
    event.after !== null &&
    String(event.before[ast.auth.roleField]) !== String(event.after[ast.auth.roleField]);
  if (!admin && !roleChanged) {
    return null;
  }
  return {
    action: roleChanged ? "role_change" : `admin.${event.op}`,
    actorId: event.actor?.id,
    actorRole: event.actor?.role,
    entity: event.entity,
    recordId: String(event.after?.id ?? event.before?.id ?? ""),
    ip: meta.ip ?? null,
    meta: roleChanged
      ? {
          from: event.before?.[ast.auth.roleField],
          to: event.after?.[ast.auth.roleField],
        }
      : undefined,
  };
}

/**
 * Writes everything durable a change produces (webhook deliveries, mail rule
 * deliveries, the audit row) using the caller's transaction, so they commit or
 * roll back with the record itself.
 */
export async function recordChange(trx: BakorinDb, ctx: AppContext, event: ChangeEvent, meta: ChangeMeta = {}): Promise<void> {
  const ast = ctx.ast;
  for (const hook of matchingHooks(ast, event)) {
    await enqueueWebhook(trx, ast, hook, event);
  }
  for (const rule of matchingRules(ast, event)) {
    await enqueueRuleMail(trx, ast, ctx.projectDir, rule, event);
  }
  const audit = auditEntryFor(ast, event, meta);
  if (audit) {
    await writeAudit(trx, audit);
  }
  await appendRealtime(trx, ast, event);
}

/**
 * Runs a write and its outbox rows in one transaction, then announces the change
 * on the bus after commit. `work` must use only the transaction it is given.
 * after* hooks and realtime fan out hang off the bus, never off the write.
 */
export async function commitChange<T>(
  ctx: AppContext,
  meta: ChangeMeta,
  work: (trx: BakorinDb) => Promise<{ event: ChangeEvent; result: T }>,
): Promise<T> {
  const { event, result } = await ctx.db.transaction().execute(async (trx) => {
    const out = await work(trx);
    await recordChange(trx, ctx, out.event, meta);
    return out;
  });
  ctx.bus.emit(event, meta);
  return result;
}
