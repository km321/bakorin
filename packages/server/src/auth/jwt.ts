import { SignJWT, jwtVerify } from "jose";

export interface AccessClaims {
  sub: string;
  role: string;
  ent: string;
  /** Issued at in milliseconds. Set on verified tokens (from `iat_ms`, or `iat` for older tokens). */
  issuedAtMs?: number;
  /** Expiry in milliseconds, set on verified tokens. Realtime streams close at this time. */
  expiresAtMs?: number;
}

export async function signAccessToken(
  claims: AccessClaims,
  secret: string,
  ttlSeconds: number,
): Promise<string> {
  const key = new TextEncoder().encode(secret);
  return new SignJWT({ role: claims.role, ent: claims.ent, iat_ms: Date.now() })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(key);
}

export async function verifyAccessToken(
  token: string,
  secret: string,
  previousSecret?: string,
): Promise<AccessClaims> {
  const secrets = [secret, previousSecret].filter((value): value is string => Boolean(value && value.length > 0));
  let lastError: unknown;
  for (const item of secrets) {
    try {
      const key = new TextEncoder().encode(item);
      const { payload } = await jwtVerify(token, key, { algorithms: ["HS256"] });
      if (!payload.sub || typeof payload.role !== "string" || typeof payload.ent !== "string") {
        throw new Error("invalid token");
      }
      return { sub: payload.sub, role: payload.role, ent: payload.ent, issuedAtMs: typeof payload.iat_ms === "number" ? payload.iat_ms : typeof payload.iat === "number" ? payload.iat * 1000 : undefined, expiresAtMs: typeof payload.exp === "number" ? payload.exp * 1000 : undefined };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("invalid token");
}

/** A short, non reversible id for an access token, so streams can be matched to a logout. */
export async function accessTokenHash(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Buffer.from(digest).toString("base64url").slice(0, 32);
}
