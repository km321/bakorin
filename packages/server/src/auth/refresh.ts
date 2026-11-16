import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { BakorinDb } from "../db/dialects.ts";
import { REFRESH_TABLE, TOKEN_CUTOFF_TABLE } from "../db/system.ts";

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

/** How long a just-rotated refresh token keeps returning its successor. */
export const REFRESH_GRACE_SECONDS = 30;

const SEAL_PREFIX = "r1:";

function sealKey(secret: string): Buffer {
  return createHash("sha256").update(`bakorin-refresh-seal:${secret}`).digest();
}

function sealToken(secret: string, token: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", sealKey(secret), iv);
  const body = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return `${SEAL_PREFIX}${Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64")}`;
}

function unsealToken(secrets: Array<string | undefined>, sealed: string): string | null {
  if (!sealed.startsWith(SEAL_PREFIX)) {
    return null;
  }
  const raw = Buffer.from(sealed.slice(SEAL_PREFIX.length), "base64");
  for (const secret of secrets) {
    if (!secret) {
      continue;
    }
    try {
      const decipher = createDecipheriv("aes-256-gcm", sealKey(secret), raw.subarray(0, 12));
      decipher.setAuthTag(raw.subarray(12, 28));
      return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
    } catch {
      // try the previous secret
    }
  }
  return null;
}

export interface RotateOptions {
  /** Current and previous JWT secrets. Needed for the parallel refresh grace window. */
  secrets?: Array<string | undefined>;
  graceSeconds?: number;
  now?: () => number;
}

type RotateResult = { userId: string; token: string } | { reuse: true; userId: string } | null;

/**
 * Rotates a refresh token atomically. Exactly one caller wins the conditional
 * update; a caller that presents the same token within the grace window (a
 * parallel server render, a retried request) gets the same successor instead of
 * a new session. Any later reuse is treated as theft and revokes every token for
 * the user.
 */
export async function rotateRefreshToken(
  db: BakorinDb,
  presented: string,
  ttlSeconds: number,
  options: RotateOptions = {},
): Promise<RotateResult> {
  const secrets = options.secrets ?? [];
  const graceMs = (options.graceSeconds ?? REFRESH_GRACE_SECONDS) * 1000;
  const now = options.now ?? Date.now;
  const hash = hashToken(presented);
  return db.transaction().execute(async (trx) => {
    const row = await trx.selectFrom(REFRESH_TABLE).selectAll().where("token_hash", "=", hash).executeTakeFirst();
    if (!row) {
      return null;
    }
    const userId = String(row.user_id);
    if (!row.revoked_at) {
      if (new Date(String(row.expires_at)).getTime() < now()) {
        return null;
      }
      const token = newToken();
      const stamp = new Date(now()).toISOString();
      const updated = await trx
        .updateTable(REFRESH_TABLE)
        .set({ revoked_at: stamp, rotated_at: stamp, successor: secrets[0] ? sealToken(secrets[0], token) : null })
        .where("id", "=", String(row.id))
        .where("revoked_at", "is", null)
        .executeTakeFirst();
      if (Number(updated.numUpdatedRows) === 1) {
        await insertRefresh(trx, userId, token, ttlSeconds, String(row.family_id), now());
        return { userId, token };
      }
    }
    // Already revoked (or another request won the race just now).
    const current = await trx.selectFrom(REFRESH_TABLE).selectAll().where("id", "=", String(row.id)).executeTakeFirstOrThrow();
    const rotatedAt = current.rotated_at ? new Date(String(current.rotated_at)).getTime() : 0;
    if (rotatedAt && now() - rotatedAt <= graceMs && current.successor) {
      const successor = unsealToken(secrets, String(current.successor));
      if (successor) {
        const next = await trx
          .selectFrom(REFRESH_TABLE)
          .select(["revoked_at", "expires_at"])
          .where("token_hash", "=", hashToken(successor))
          .executeTakeFirst();
        if (next && !next.revoked_at && new Date(String(next.expires_at)).getTime() >= now()) {
          return { userId, token: successor };
        }
      }
    }
    await trx.updateTable(REFRESH_TABLE).set({ revoked_at: new Date(now()).toISOString() }).where("user_id", "=", userId).where("revoked_at", "is", null).execute();
    return { reuse: true as const, userId };
  });
}

async function insertRefresh(db: BakorinDb, userId: string, token: string, ttlSeconds: number, familyId: string, nowMs: number) {
  await db
    .insertInto(REFRESH_TABLE)
    .values({
      id: crypto.randomUUID(),
      user_id: userId,
      token_hash: hashToken(token),
      family_id: familyId,
      revoked_at: null,
      expires_at: new Date(nowMs + ttlSeconds * 1000).toISOString(),
      created_at: new Date(nowMs).toISOString(),
    })
    .execute();
}

export async function revokeToken(db: BakorinDb, presented: string): Promise<void> {
  await db
    .updateTable(REFRESH_TABLE)
    .set({ revoked_at: new Date().toISOString() })
    .where("token_hash", "=", hashToken(presented))
    .execute();
}

/**
 * Signs a user out everywhere: revokes every refresh token and rejects access
 * tokens issued before now (checked per request in app.ts).
 */
export async function revokeAllForUser(db: BakorinDb, userId: string): Promise<void> {
  await db.updateTable(REFRESH_TABLE).set({ revoked_at: new Date().toISOString() }).where("user_id", "=", userId).execute();
  const notBefore = Date.now();
  await db
    .insertInto(TOKEN_CUTOFF_TABLE)
    .values({ user_id: userId, not_before: notBefore })
    .onConflict((oc) => oc.column("user_id").doUpdateSet({ not_before: notBefore }))
    .execute();
}

/** Milliseconds since epoch before which this user's access tokens are rejected, or 0. */
export async function tokenCutoff(db: BakorinDb, userId: string): Promise<number> {
  const row = await db.selectFrom(TOKEN_CUTOFF_TABLE).select("not_before").where("user_id", "=", userId).executeTakeFirst();
  return row ? Number(row.not_before) : 0;
}
