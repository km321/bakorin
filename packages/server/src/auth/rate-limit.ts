import { sql } from "kysely";
import type { BakorinDb } from "../db/dialects.ts";
import { RATE_TABLE } from "../db/system.ts";

/** DB-backed fixed window. Empty when a new database boots, so tests stay isolated. */
export async function rateLimit(db: BakorinDb, key: string, limit: number, windowMs: number): Promise<boolean> {
  const now = Date.now();
  const row = await db.selectFrom(RATE_TABLE).selectAll().where("key", "=", key).executeTakeFirst();
  const windowStart = row ? Date.parse(String(row.window_start)) : Number.NaN;
  const fresh = !row || Number.isNaN(windowStart) || now - windowStart >= windowMs;
  if (fresh) {
    await db.deleteFrom(RATE_TABLE).where("key", "=", key).execute();
    try {
      await db
        .insertInto(RATE_TABLE)
        .values({ key, count: 1, window_start: new Date(now).toISOString() })
        .execute();
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/unique|primary key|constraint/i.test(message)) {
        throw error;
      }
    }
  }
  const latest = await db.selectFrom(RATE_TABLE).selectAll().where("key", "=", key).executeTakeFirst();
  const count = Number(latest?.count ?? 0);
  if (count >= limit) {
    return false;
  }
  await sql`update ${sql.table(RATE_TABLE)} set count = count + 1 where key = ${key}`.execute(db);
  return true;
}

export function resetRateLimit(): void {
  // Limits live in the database. A new boot() uses a fresh file, so this is a no-op for tests.
}

export interface RateRule {
  limit: number;
  windowSeconds: number;
  per: "ip" | "user";
}

/**
 * Apply an app.yaml rateLimit rule. Keyed per client IP, or per signed in user
 * when `per: user` (signed out callers fall back to their IP).
 */
export async function checkRateRule(
  db: BakorinDb,
  scope: string,
  rule: RateRule | undefined,
  ip: string,
  actorId: string | null,
): Promise<boolean> {
  if (!rule) {
    return true;
  }
  const who = rule.per === "user" && actorId ? `user:${actorId}` : `ip:${ip}`;
  return rateLimit(db, `${scope}:${who}`, rule.limit, rule.windowSeconds * 1000);
}

export function rateLimitedResponse(rule: RateRule, message: string): Response {
  return Response.json(
    { error: { code: "rate_limited", message } },
    { status: 429, headers: { "retry-after": String(rule.windowSeconds) } },
  );
}
