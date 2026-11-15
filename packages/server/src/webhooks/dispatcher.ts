import { createHmac } from "node:crypto";
import type { ChangeEvent, SchemaAST } from "@bakorin/core";
import type { BakorinDb } from "../db/dialects.ts";
import { WEBHOOK_OUTBOX_TABLE } from "../db/system.ts";
import { acquireLease, instanceHolder } from "../db/leases.ts";

async function postOnce(url: string, body: string, headers: Record<string, string>): Promise<boolean> {
  try {
    const response = await fetch(url, { method: "POST", headers, body });
    return response.ok;
  } catch {
    return false;
  }
}

export function subscribeWebhooks(
  ast: SchemaAST,
  db: BakorinDb,
  subscribe: (handler: (event: ChangeEvent) => void) => void,
): void {
  if (ast.webhooks.length === 0) {
    return;
  }
  subscribe((event) => {
    void (async () => {
      for (const hook of ast.webhooks) {
        if (hook.entity !== "*" && hook.entity !== event.entity) {
          continue;
        }
        if (!hook.events.includes(event.op)) {
          continue;
        }
        const payload = JSON.stringify({
          event: `${event.entity}.${event.op}`,
          entity: event.entity,
          op: event.op,
          before: event.before,
          after: event.after,
          actor: event.actor,
        });
        const headers: Record<string, string> = {
          "content-type": "application/json",
          "x-bakorin-event": `${event.entity}.${event.op}`,
        };
        if (hook.secret) {
          const signature = createHmac("sha256", hook.secret).update(payload).digest("hex");
          headers["x-bakorin-signature"] = `sha256=${signature}`;
        }
        const now = new Date().toISOString();
        await db
          .insertInto(WEBHOOK_OUTBOX_TABLE)
          .values({
            id: crypto.randomUUID(),
            url: hook.url,
            payload,
            headers: JSON.stringify(headers),
            attempts: 0,
            locked_until: null,
            next_attempt_at: now,
            delivered_at: null,
            created_at: now,
          })
          .execute();
      }
    })();
  });
}

export function startWebhookWorker(db: BakorinDb): () => void {
  const holder = instanceHolder();
  let stopped = false;
  const timer = setInterval(() => {
    if (stopped) {
      return;
    }
    void drainOutbox(db, holder, () => stopped);
  }, 1000);
  void drainOutbox(db, holder, () => stopped);
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

async function drainOutbox(db: BakorinDb, holder: string, stopped: () => boolean): Promise<void> {
  if (stopped()) {
    return;
  }
  try {
    const got = await acquireLease(db, "webhook-dispatcher", holder, 15_000);
    if (!got || stopped()) {
      return;
    }
    const now = new Date().toISOString();
    const rows = await db
      .selectFrom(WEBHOOK_OUTBOX_TABLE)
      .selectAll()
      .where("delivered_at", "is", null)
      .where("next_attempt_at", "<=", now)
      .orderBy("created_at", "asc")
      .limit(20)
      .execute();
    for (const row of rows) {
      if (stopped()) {
        return;
      }
      const lockUntil = new Date(Date.now() + 30_000).toISOString();
      const claimed = await db
        .updateTable(WEBHOOK_OUTBOX_TABLE)
        .set({ locked_until: lockUntil })
        .where("id", "=", String(row.id))
        .where("delivered_at", "is", null)
        .executeTakeFirst();
      const updated = Number(claimed?.numUpdatedRows ?? 0);
      if (updated < 1) {
        continue;
      }
      const headers = JSON.parse(String(row.headers)) as Record<string, string>;
      const ok = await postOnce(String(row.url), String(row.payload), headers);
      const attempts = Number(row.attempts) + 1;
      if (ok) {
        await db
          .updateTable(WEBHOOK_OUTBOX_TABLE)
          .set({ delivered_at: new Date().toISOString(), attempts })
          .where("id", "=", String(row.id))
          .execute();
      } else {
        const delay = Math.min(60_000, 100 * 2 ** Math.min(attempts, 8));
        await db
          .updateTable(WEBHOOK_OUTBOX_TABLE)
          .set({
            attempts,
            locked_until: null,
            next_attempt_at: new Date(Date.now() + delay).toISOString(),
          })
          .where("id", "=", String(row.id))
          .execute();
      }
    }
  } catch {
    // Database already closed during shutdown.
  }
}
