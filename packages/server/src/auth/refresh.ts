import { createHash, randomBytes } from "node:crypto";
import type { BakorinDb } from "../db/dialects.ts";
import { REFRESH_TABLE } from "../db/system.ts";

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

export async function issueRefreshToken(
  db: BakorinDb,
  userId: string,
  ttlSeconds: number,
  familyId: string = crypto.randomUUID(),
): Promise<string> {
  const token = newToken();
  const now = new Date();
  await db
    .insertInto(REFRESH_TABLE)
    .values({
      id: crypto.randomUUID(),
      user_id: userId,
      token_hash: hashToken(token),
      family_id: familyId,
      revoked_at: null,
      expires_at: new Date(now.getTime() + ttlSeconds * 1000).toISOString(),
      created_at: now.toISOString(),
    })
    .execute();
  return token;
}

export async function rotateRefreshToken(
  db: BakorinDb,
  presented: string,
  ttlSeconds: number,
): Promise<{ userId: string; token: string } | { reuse: true; userId: string } | null> {
  const hash = hashToken(presented);
  const row = await db
    .selectFrom(REFRESH_TABLE)
    .selectAll()
    .where("token_hash", "=", hash)
    .executeTakeFirst();
  if (!row) {
    return null;
  }
  const userId = String(row.user_id);
  if (row.revoked_at) {
    await db.updateTable(REFRESH_TABLE).set({ revoked_at: new Date().toISOString() }).where("user_id", "=", userId).execute();
    return { reuse: true, userId };
  }
  if (new Date(String(row.expires_at)).getTime() < Date.now()) {
    return null;
  }
  await db
    .updateTable(REFRESH_TABLE)
    .set({ revoked_at: new Date().toISOString() })
    .where("id", "=", String(row.id))
    .execute();
  const token = await issueRefreshToken(db, userId, ttlSeconds, String(row.family_id));
  return { userId, token };
}

export async function revokeToken(db: BakorinDb, presented: string): Promise<void> {
  await db
    .updateTable(REFRESH_TABLE)
    .set({ revoked_at: new Date().toISOString() })
    .where("token_hash", "=", hashToken(presented))
    .execute();
}

export async function revokeAllForUser(db: BakorinDb, userId: string): Promise<void> {
  await db.updateTable(REFRESH_TABLE).set({ revoked_at: new Date().toISOString() }).where("user_id", "=", userId).execute();
}
