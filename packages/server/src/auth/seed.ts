import { quoteChecked, type SchemaAST } from "@bakorin/core";
import { sql } from "kysely";
import type { BakorinDb } from "../db/dialects.ts";
import { encodeValue } from "../db/types.ts";
import { hashPassword } from "./password.ts";

function readEnv(env: Record<string, string | undefined>, name: string): string | undefined {
  const value = env[name];
  return value && value !== "" ? value : undefined;
}

export async function countAdmins(ast: SchemaAST, db: BakorinDb): Promise<number> {
  const entity = ast.entityMap[ast.auth.entity];
  if (!entity) {
    return 0;
  }
  const countRow = await db
    .selectFrom(entity.name)
    .select(db.fn.countAll().as("count"))
    .where(ast.auth.roleField, "=", ast.auth.adminRole)
    .executeTakeFirst();
  return Number(countRow?.count ?? 0);
}

export async function hasAdmin(ast: SchemaAST, db: BakorinDb): Promise<boolean> {
  return (await countAdmins(ast, db)) > 0;
}

export interface FirstAdminInput {
  email: string;
  password: string;
  name?: string;
}

export type FirstAdminResult =
  | { status: "created"; id: string }
  | { status: "exists" };

let firstAdminChain: Promise<unknown> = Promise.resolve();

function enqueueFirstAdmin<T>(work: () => Promise<T>): Promise<T> {
  const next = firstAdminChain.then(work, work);
  firstAdminChain = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

async function buildAdminInsert(
  ast: SchemaAST,
  input: FirstAdminInput,
): Promise<{ entityName: string; insert: Record<string, unknown>; id: string }> {
  const entity = ast.entityMap[ast.auth.entity];
  if (!entity) {
    throw new Error("auth entity missing; cannot create admin");
  }
  const email = input.email.trim().toLowerCase();
  const password = input.password;
  if (!email || password.length < 8) {
    throw new Error("email and a password of at least 8 characters are required");
  }
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const name = input.name?.trim() || "Admin";
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
    if (field.name === "emailVerified") {
      insert[field.name] = encodeValue(ast.runtime.dialect, field, true);
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
      throw new Error(`cannot create admin: required field ${entity.name}.${field.name} has no value`);
    }
  }
  return { entityName: entity.name, insert, id };
}

export async function createFirstAdmin(ast: SchemaAST, db: BakorinDb, input: FirstAdminInput): Promise<FirstAdminResult> {
  const built = await buildAdminInsert(ast, input);
  return enqueueFirstAdmin(async () => {
    return await db.transaction().execute(async (trx) => {
      if (ast.runtime.dialect === "postgres") {
        await sql.raw(`lock table ${quoteChecked(built.entityName)} in share row exclusive mode`).execute(trx);
      }
      if ((await countAdmins(ast, trx)) > 0) {
        return { status: "exists" as const };
      }
      await trx.insertInto(built.entityName).values(built.insert).execute();
      if ((await countAdmins(ast, trx)) > 1) {
        await trx.deleteFrom(built.entityName).where("id", "=", built.id).execute();
        return { status: "exists" as const };
      }
      return { status: "created" as const, id: built.id };
    });
  });
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
  const name = readEnv(env, "BAKORIN_ADMIN_NAME");
  const result = await createFirstAdmin(ast, db, { email, password, name });
  if (result.status === "exists") {
    return;
  }
  console.log(`[bakorin] seeded first-boot admin ${email.trim().toLowerCase()}`);
}

export async function seedAdminOrLog(
  ast: SchemaAST,
  db: BakorinDb,
  env: Record<string, string | undefined> = process.env,
): Promise<void> {
  const email = readEnv(env, "BAKORIN_ADMIN_EMAIL");
  const password = readEnv(env, "BAKORIN_ADMIN_PASSWORD");
  if (!email && !password) {
    return;
  }
  if (!email || !password) {
    console.error(
      "[bakorin] admin seeding skipped: set both BAKORIN_ADMIN_EMAIL and BAKORIN_ADMIN_PASSWORD, or create the first admin at /admin/",
    );
    return;
  }
  try {
    await seedAdminIfRequested(ast, db, env);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[bakorin] admin seeding failed: ${message}`);
    console.error("[bakorin] fix BAKORIN_ADMIN_EMAIL / BAKORIN_ADMIN_PASSWORD, or create the first admin at /admin/");
  }
}
