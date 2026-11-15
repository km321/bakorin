import { createHmac, timingSafeEqual } from "node:crypto";

export function signFileUrl(secret: string, fileId: string, exp: number): string {
  const payload = `${fileId}:${exp}`;
  const sig = createHmac("sha256", secret).update(payload).digest("base64url");
  return `/api/v1/files/${fileId}?exp=${exp}&sig=${sig}`;
}

function matchSignature(secret: string, fileId: string, exp: number, sig: string): boolean {
  const expected = createHmac("sha256", secret).update(`${fileId}:${exp}`).digest("base64url");
  const left = Buffer.from(sig);
  const right = Buffer.from(expected);
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}

export function verifyFileSignature(
  secret: string,
  fileId: string,
  expRaw: string | undefined,
  sig: string | undefined,
  previousSecret?: string,
): boolean {
  if (!expRaw || !sig) {
    return false;
  }
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || exp * 1000 < Date.now()) {
    return false;
  }
  if (matchSignature(secret, fileId, exp, sig)) {
    return true;
  }
  return Boolean(previousSecret && matchSignature(previousSecret, fileId, exp, sig));
}
