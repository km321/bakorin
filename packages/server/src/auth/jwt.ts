import { SignJWT, jwtVerify } from "jose";

export interface AccessClaims {
  sub: string;
  role: string;
  ent: string;
}

export async function signAccessToken(
  claims: AccessClaims,
  secret: string,
  ttlSeconds: number,
): Promise<string> {
  const key = new TextEncoder().encode(secret);
  return new SignJWT({ role: claims.role, ent: claims.ent })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(key);
}

export async function verifyAccessToken(token: string, secret: string): Promise<AccessClaims> {
  const key = new TextEncoder().encode(secret);
  const { payload } = await jwtVerify(token, key, { algorithms: ["HS256"] });
  if (!payload.sub || typeof payload.role !== "string" || typeof payload.ent !== "string") {
    throw new Error("invalid token");
  }
  return { sub: payload.sub, role: payload.role, ent: payload.ent };
}
