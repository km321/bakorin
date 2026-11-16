import type { BakorinDb } from "../db/dialects.ts";
import { LOCKOUT_TABLE } from "../db/system.ts";

const LOCK_AFTER = 5;

/**
 * Locks are per identity and client IP, so someone failing logins from their own
 * address cannot lock the real owner out everywhere. The per IP login rate limit
 * still caps guessing across many identities.
 */
export function lockoutKey(identity: string, ip: string): string {
  return `${identity}|${ip}`;
}

function backoffMs(failures: number): number {
  const extra = Math.max(0, failures - LOCK_AFTER);
  const minutes = Math.min(60, 2 ** extra);
  return minutes * 60 * 1000;
}

export async function getLockout(
  db: BakorinDb,
  identity: string,
): Promise<{ locked: boolean; until: string | null; failures: number }> {
  const row = await db.selectFrom(LOCKOUT_TABLE).selectAll().where("identity", "=", identity).executeTakeFirst();
  if (!row) {
    return { locked: false, until: null, failures: 0 };
  }
  const until = row.locked_until ? String(row.locked_until) : null;
  if (until && Date.parse(until) > Date.now()) {
    return { locked: true, until, failures: Number(row.failures) };
  }
  return { locked: false, until: null, failures: Number(row.failures) };
}

export async function recordFailedLogin(db: BakorinDb, identity: string): Promise<{ locked: boolean; until: string | null }> {
  const current = await getLockout(db, identity);
  const failures = current.failures + 1;
  const now = new Date().toISOString();
  const lock = failures >= LOCK_AFTER;
  const until = lock ? new Date(Date.now() + backoffMs(failures)).toISOString() : null;
  const existing = await db.selectFrom(LOCKOUT_TABLE).select("identity").where("identity", "=", identity).executeTakeFirst();
  if (existing) {
    await db
      .updateTable(LOCKOUT_TABLE)
      .set({ failures, locked_until: until, updated_at: now })
      .where("identity", "=", identity)
      .execute();
  } else {
    await db.insertInto(LOCKOUT_TABLE).values({ identity, failures, locked_until: until, updated_at: now }).execute();
  }
  return { locked: Boolean(until && Date.parse(until) > Date.now()), until };
}

export async function clearLockout(db: BakorinDb, identity: string): Promise<void> {
  await db.deleteFrom(LOCKOUT_TABLE).where("identity", "=", identity).execute();
}
