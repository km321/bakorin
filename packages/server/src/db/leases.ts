import type { BakorinDb } from "./dialects.ts";
import { LEASE_TABLE } from "./system.ts";

export function instanceHolder(): string {
  return `${process.pid}-${crypto.randomUUID().slice(0, 8)}`;
}

export async function acquireLease(db: BakorinDb, name: string, holder: string, ttlMs: number): Promise<boolean> {
  const now = new Date().toISOString();
  const expires = new Date(Date.now() + ttlMs).toISOString();
  await db.deleteFrom(LEASE_TABLE).where("name", "=", name).where("expires_at", "<", now).execute();
  const existing = await db.selectFrom(LEASE_TABLE).selectAll().where("name", "=", name).executeTakeFirst();
  if (!existing) {
    try {
      await db.insertInto(LEASE_TABLE).values({ name, holder, expires_at: expires }).execute();
      return true;
    } catch {
      return false;
    }
  }
  if (String(existing.holder) === holder) {
    await db
      .updateTable(LEASE_TABLE)
      .set({ expires_at: expires })
      .where("name", "=", name)
      .where("holder", "=", holder)
      .execute();
    return true;
  }
  return false;
}

export async function releaseLease(db: BakorinDb, name: string, holder: string): Promise<void> {
  await db.deleteFrom(LEASE_TABLE).where("name", "=", name).where("holder", "=", holder).execute();
}
