import type { EntityAST, FieldAST, FieldWritable, SchemaAST } from "@bakorin/core";
import type { Actor } from "../context.ts";
import { verifyPassword } from "../auth/password.ts";
import { InputError } from "./validate.ts";

export class ForbiddenError extends Error {
  readonly status = 403 as const;
  constructor(message: string) {
    super(message);
    this.name = "ForbiddenError";
  }
}

export function isAdminActor(ast: SchemaAST, actor: Actor | null): boolean {
  return Boolean(actor && actor.role === ast.auth.adminRole);
}

export function effectiveWritable(ast: SchemaAST, entity: EntityAST, field: FieldAST): FieldWritable {
  if (entity.name === ast.auth.entity && field.name === ast.auth.roleField) {
    return "admin";
  }
  return field.writable;
}

export function safeDefaultRole(ast: SchemaAST, field: FieldAST): string {
  const def = field.defaultValue;
  if (typeof def === "string" && def !== ast.auth.adminRole) {
    return def;
  }
  return field.enumValues?.find((value) => value !== ast.auth.adminRole) ?? "user";
}

/**
 * Non-admin writes that include a locked field return 403.
 * Ownership fields (ownerId, auth relations) cannot be taken over.
 * Omitted locked fields are filled from defaults / the session, not rejected.
 */
export function assertClientFieldWrites(
  ast: SchemaAST,
  entity: EntityAST,
  raw: Record<string, unknown>,
  actor: Actor | null,
  ownershipFields: string[],
  action: "create" | "update",
): void {
  const admin = isAdminActor(ast, actor);
  for (const key of Object.keys(raw)) {
    if (key === "currentPassword") {
      continue;
    }
    const field = entity.fieldMap[key];
    if (!field) {
      continue;
    }
    const writable = effectiveWritable(ast, entity, field);
    switch (writable) {
      case "none":
        throw new ForbiddenError(`${key} is read-only`);
      case "admin":
        if (!admin) {
          throw new ForbiddenError(`${key} can only be set by an admin`);
        }
        break;
      case "any":
        break;
      default: {
        const _never: never = writable;
        throw new ForbiddenError(`unknown writable mode ${String(_never)}`);
      }
    }
    if (!admin && ownershipFields.includes(key)) {
      if (action === "update") {
        throw new ForbiddenError(`${key} cannot be changed`);
      }
      if (!actor || String(raw[key]) !== actor.id) {
        throw new ForbiddenError(`${key} cannot be set`);
      }
    }
  }
}

export function applyAuthCreateDefaults(
  ast: SchemaAST,
  entity: EntityAST,
  body: Record<string, unknown>,
  actor: Actor | null,
): void {
  if (entity.name !== ast.auth.entity) {
    return;
  }
  const roleField = entity.fieldMap[ast.auth.roleField];
  if (!roleField) {
    return;
  }
  if (!isAdminActor(ast, actor)) {
    body[ast.auth.roleField] = safeDefaultRole(ast, roleField);
  }
}

export function stripDisallowedWrites(
  ast: SchemaAST,
  entity: EntityAST,
  data: Record<string, unknown>,
  actor: Actor | null,
): Record<string, unknown> {
  const admin = isAdminActor(ast, actor);
  const next = { ...data };
  for (const key of Object.keys(next)) {
    const field = entity.fieldMap[key];
    if (!field) {
      delete next[key];
      continue;
    }
    const writable = effectiveWritable(ast, entity, field);
    if (writable === "none" || (writable === "admin" && !admin)) {
      delete next[key];
    }
  }
  return next;
}

export async function assertPasswordWrite(
  ast: SchemaAST,
  entity: EntityAST,
  body: Record<string, unknown>,
  raw: Record<string, unknown>,
  actor: Actor | null,
  existing: Record<string, unknown> | null,
): Promise<boolean> {
  const fieldName = ast.auth.passwordField;
  if (entity.name !== ast.auth.entity || !(fieldName in body)) {
    return false;
  }
  const next = body[fieldName];
  if (typeof next !== "string" || next.length === 0) {
    delete body[fieldName];
    return false;
  }
  if (next.length < 8) {
    throw new InputError(fieldName, `${fieldName} must be at least 8 characters`);
  }
  if (existing === null) {
    return true;
  }
  if (isAdminActor(ast, actor)) {
    return true;
  }
  if (!actor || actor.id !== String(existing.id)) {
    throw new ForbiddenError(`${fieldName} can only be changed by that user or an admin`);
  }
  const current = raw.currentPassword;
  if (typeof current !== "string" || current.length === 0) {
    throw new InputError("currentPassword", "currentPassword is required to change your password");
  }
  const ok = await verifyPassword(current, String(existing[fieldName] ?? ""));
  if (!ok) {
    throw new InputError("currentPassword", "currentPassword is incorrect");
  }
  return true;
}
