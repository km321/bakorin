import type { BakorinDb } from "../db/dialects.ts";
import { MAIL_OUTBOX_TABLE, WEBHOOK_OUTBOX_TABLE } from "../db/system.ts";

export interface PendingDeliveries {
  webhooks: number;
  mail: number;
}

const WAITING = ["pending", "sending"];

/** Webhook and mail rows that would still be sent once the server starts. */
export async function countPendingDeliveries(db: BakorinDb): Promise<PendingDeliveries> {
  const count = async (table: string) => {
    const row = await db
      .selectFrom(table)
      .select(db.fn.countAll().as("n"))
      .where("status", "in", WAITING)
      .executeTakeFirst();
    return Number((row as { n?: number | string } | undefined)?.n ?? 0);
  };
  return { webhooks: await count(WEBHOOK_OUTBOX_TABLE), mail: await count(MAIL_OUTBOX_TABLE) };
}

/**
 * Mark every waiting delivery as discarded, so a production backup restored into
 * staging does not email customers or call real webhooks. Rows stay in the
 * delivery logs as discarded.
 */
export async function discardPendingDeliveries(db: BakorinDb): Promise<PendingDeliveries> {
  const discard = async (table: string) => {
    const result = await db
      .updateTable(table)
      .set({ status: "discarded", locked_until: null })
      .where("status", "in", WAITING)
      .executeTakeFirst();
    return Number(result.numUpdatedRows ?? 0);
  };
  return { webhooks: await discard(WEBHOOK_OUTBOX_TABLE), mail: await discard(MAIL_OUTBOX_TABLE) };
}
