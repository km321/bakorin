import type { EntityAST, PolicyAST, SchemaAST } from "@bakorin/core";
import type { Actor } from "../context.ts";

export interface AccessDecision {
  allow: boolean;
  status: 401 | 403 | 200;
  ownerFields: string[];
  actorId: string | null;
  bypass: boolean;
}

function isAdmin(actor: Actor | null, ast: SchemaAST): boolean {
  return Boolean(actor && actor.role === ast.auth.adminRole);
}

function matchesUnrestricted(policy: PolicyAST, actor: Actor | null, ast: SchemaAST): boolean {
  switch (policy.kind) {
    case "public":
      return true;
    case "authenticated":
      return actor !== null;
    case "admin":
      return isAdmin(actor, ast);
    case "role":
      return Boolean(actor && actor.role === policy.role);
    case "owner":
      return false;
    default: {
      const _never: never = policy;
      return _never;
    }
  }
}

export function decideAccess(
  ast: SchemaAST,
  entity: EntityAST,
  action: "read" | "create" | "update" | "delete",
  actor: Actor | null,
): AccessDecision {
  const policies = entity.policies[action];
  if (isAdmin(actor, ast)) {
    return { allow: true, status: 200, ownerFields: [], actorId: actor?.id ?? null, bypass: true };
  }
  if (policies.some((policy) => matchesUnrestricted(policy, actor, ast))) {
    return { allow: true, status: 200, ownerFields: [], actorId: actor?.id ?? null, bypass: false };
  }
  const owners = policies.filter((policy): policy is Extract<PolicyAST, { kind: "owner" }> => policy.kind === "owner");
  if (owners.length > 0 && actor) {
    return {
      allow: true,
      status: 200,
      ownerFields: owners.map((policy) => policy.field),
      actorId: actor.id,
      bypass: false,
    };
  }
  const needsAuth = policies.every((policy) => policy.kind !== "public");
  if (!actor && needsAuth) {
    return { allow: false, status: 401, ownerFields: [], actorId: null, bypass: false };
  }
  return { allow: false, status: 403, ownerFields: [], actorId: actor?.id ?? null, bypass: false };
}

export function ownerFields(entity: EntityAST, action: "read" | "create" | "update" | "delete"): string[] {
  return entity.policies[action]
    .filter((policy): policy is Extract<PolicyAST, { kind: "owner" }> => policy.kind === "owner")
    .map((policy) => policy.field);
}

/** Fields the client must not choose: owner() policies plus relations to the auth entity. */
export function ownedByFields(entity: EntityAST, authEntity: string): string[] {
  const fromPolicies = (["read", "create", "update", "delete"] as const)
    .flatMap((action) => ownerFields(entity, action))
    .filter((field) => field !== "id");
  const fromRelations = entity.fields.filter((field) => field.relation?.to === authEntity).map((field) => field.name);
  return [...new Set([...fromPolicies, ...fromRelations])];
}
