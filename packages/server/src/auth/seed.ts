import type { SchemaAST } from "@bakorin/core";
import type { BakorinDb } from "../db/dialects.ts";
import { encodeValue } from "../db/types.ts";
import { hashPassword } from "./password.ts";

function readEnv(env: Record<string, string | undefined>, name: string): string | undefined {
  const value = env[name];
  return value && value !== "" ? value : undefined;
}

export async function seedAdminIfRequested(
  ast: SchemaAST,
  db: BakorinDb,
  env: Record<string, string | undefined> = process.env,
): Promise<void> {
  const email = readEnv(env, "BAKORIN_ADMIN_EMAIL");
  const password = readEnv(env, "BAKORIN_ADMIN_PASSWORD");
  if (!email || !password) {
    return;
  }
  if (password.length < 8) {
    throw new Error("BAKORIN_ADMIN_PASSWORD must be at least 8 characters");
  }
  const entity = ast.entityMap[ast.auth.entity];
  if (!entity) {
    throw new Error("auth entity missing; cannot seed admin");
  }
  const countRow = await db.selectFrom(entity.name).select(db.fn.countAll().as("count")).executeTakeFirst();
  if (Number(countRow?.count ?? 0) > 0) {
    return;
  }
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const name = readEnv(env, "BAKORIN_ADMIN_NAME") ?? "Admin";
  const insert: Record<string, unknown> = {
    id,
    createdAt: now,
    updatedAt: now,
  };
  for (const field of entity.fields) {
    if (field.name === "id" || field.name === "createdAt" || field.name === "updatedAt") {
      continue;
    }
    if (field.name === ast.auth.passwordField) {
      insert[field.name] = await hashPassword(password);
      continue;
    }
    if (field.name === ast.auth.identityField) {
      insert[field.name] = encodeValue(ast.runtime.dialect, field, email);
      continue;
    }
    if (field.name === ast.auth.roleField) {
      insert[field.name] = encodeValue(ast.runtime.dialect, field, ast.auth.adminRole);
      continue;
    }
    if (field.name === "name") {
      insert[field.name] = encodeValue(ast.runtime.dialect, field, name);
      continue;
    }
    if (field.defaultValue !== undefined) {
      insert[field.name] = encodeValue(ast.runtime.dialect, field, field.defaultValue);
      continue;
    }
    if (field.required) {
      throw new Error(`cannot seed admin: required field ${entity.name}.${field.name} has no value`);
    }
  }
  await db.insertInto(entity.name).values(insert).execute();
  console.log(`[bakorin] seeded first-boot admin ${email}`);
}
