const TEST = process.env.BAKORIN_TEST === "1";

export async function hashPassword(password: string): Promise<string> {
  return Bun.password.hash(password, {
    algorithm: "argon2id",
    memoryCost: TEST ? 4096 : 19456,
    timeCost: TEST ? 1 : 2,
  });
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return Bun.password.verify(password, hash);
}
