import { hashToken, newToken } from "./refresh.ts";
import type { BakorinDb } from "../db/dialects.ts";
import { AUTH_TOKENS_TABLE } from "../db/system.ts";

export type AuthTokenPurpose = "reset" | "verify" | "invite";

export interface AuthTokenRow {
  id: string;
  userId: string | null;
  email: string;
  purpose: AuthTokenPurpose;
  payload: Record<string, unknown> | null;
}

export async function issueAuthToken(
  db: BakorinDb,
  options: {
    userId?: string | null;
    email: string;
    purpose: AuthTokenPurpose;
    ttlSeconds: number;
    payload?: Record<string, unknown>;
  },
): Promise<string> {
  const token = newToken();
  const now = new Date();
  await db
    .insertInto(AUTH_TOKENS_TABLE)
    .values({
      id: crypto.randomUUID(),
      user_id: options.userId ?? null,
      email: options.email,
      purpose: options.purpose,
      token_hash: hashToken(token),
      payload: options.payload ? JSON.stringify(options.payload) : null,
      expires_at: new Date(now.getTime() + options.ttlSeconds * 1000).toISOString(),
      used_at: null,
      created_at: now.toISOString(),
    })
    .execute();
  return token;
}

export async function consumeAuthToken(
  db: BakorinDb,
  presented: string,
  purpose: AuthTokenPurpose,
): Promise<AuthTokenRow | null> {
  const row = await db
    .selectFrom(AUTH_TOKENS_TABLE)
    .selectAll()
    .where("token_hash", "=", hashToken(presented))
    .where("purpose", "=", purpose)
    .executeTakeFirst();
  if (!row) {
    return null;
  }
  if (row.used_at) {
    return null;
  }
  if (new Date(String(row.expires_at)).getTime() < Date.now()) {
    return null;
  }
  await db
    .updateTable(AUTH_TOKENS_TABLE)
    .set({ used_at: new Date().toISOString() })
    .where("id", "=", String(row.id))
    .execute();
  let payload: Record<string, unknown> | null = null;
  if (typeof row.payload === "string" && row.payload.length > 0) {
    try {
      payload = JSON.parse(row.payload) as Record<string, unknown>;
    } catch {
      payload = null;
    }
  }
  return {
    id: String(row.id),
    userId: row.user_id === null || row.user_id === undefined ? null : String(row.user_id),
    email: String(row.email),
    purpose,
    payload,
  };
}

export function accountLink(appUrl: string, path: string, token: string): string {
  const base = appUrl.replace(/\/+$/, "");
  return `${base}${path}?token=${encodeURIComponent(token)}`;
}
