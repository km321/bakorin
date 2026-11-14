import { SchemaError } from "./errors.ts";
import type { PolicyAST } from "./ast.ts";

const OWNER = /^owner\(([A-Za-z_][A-Za-z0-9_]*)\)$/;
const ROLE = /^role\(([A-Za-z0-9_-]+)\)$/;

export function parsePolicy(expr: string): PolicyAST {
  const trimmed = expr.trim();
  switch (trimmed) {
    case "public":
      return { kind: "public" };
    case "authenticated":
      return { kind: "authenticated" };
    case "admin":
      return { kind: "admin" };
    default: {
      const owner = OWNER.exec(trimmed);
      if (owner?.[1]) {
        return { kind: "owner", field: owner[1] };
      }
      const role = ROLE.exec(trimmed);
      if (role?.[1]) {
        return { kind: "role", role: role[1] };
      }
      throw new SchemaError(
        `invalid policy ${JSON.stringify(expr)}; expected public, authenticated, admin, owner(field), or role(name)`,
      );
    }
  }
}

export function parsePolicies(value: string | string[] | undefined, fallback: PolicyAST[]): PolicyAST[] {
  if (value === undefined) {
    return fallback;
  }
  const list = Array.isArray(value) ? value : [value];
  return list.map(parsePolicy);
}

export function policyRequiresAuth(policies: PolicyAST[]): boolean {
  return policies.every((policy) => policy.kind !== "public");
}

export function describePolicy(policy: PolicyAST): string {
  switch (policy.kind) {
    case "public":
      return "public";
    case "authenticated":
      return "authenticated";
    case "admin":
      return "admin";
    case "owner":
      return `owner(${policy.field})`;
    case "role":
      return `role(${policy.role})`;
    default: {
      const _never: never = policy;
      return _never;
    }
  }
}
