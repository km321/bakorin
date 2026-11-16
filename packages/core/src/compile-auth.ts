/** The auth entity: which entity signs in, signup mode, and private auth fields. */

import { SchemaError } from "./errors.ts";
import type { AppYaml } from "./yaml-schema.ts";
import type { AuthAST, EntityAST, FieldAST, SignupMode } from "./ast.ts";

export function findAuthEntity(yaml: AppYaml, entities: EntityAST[]): AuthAST {
  const marked = entities.filter((entity) => entity.auth);
  const configured = yaml.auth?.entity;
  let entity: EntityAST | undefined;
  if (configured) {
    entity = entities.find((item) => item.name === configured);
    if (!entity) {
      throw new SchemaError(`auth.entity ${configured} does not exist`);
    }
  } else if (marked.length === 1) {
    entity = marked[0];
  } else if (marked.length > 1) {
    throw new SchemaError("multiple entities have auth: true; set auth.entity explicitly");
  } else {
    entity = entities.find((item) => item.name === "users");
  }
  if (!entity) {
    throw new SchemaError("an auth entity is required; mark one entity with auth: true");
  }
  entity.auth = true;
  const identityField = yaml.auth?.identity ?? "email";
  const passwordField = yaml.auth?.password ?? "password";
  const roleField = yaml.auth?.role ?? "role";
  if (!entity.fieldMap[identityField]) {
    throw new SchemaError(`auth identity field ${entity.name}.${identityField} is missing`);
  }
  if (!entity.fieldMap[passwordField] || entity.fieldMap[passwordField]?.type !== "password") {
    throw new SchemaError(`auth password field ${entity.name}.${passwordField} must have type password`);
  }
  if (!entity.fieldMap[roleField] || entity.fieldMap[roleField]?.type !== "enum") {
    throw new SchemaError(`auth role field ${entity.name}.${roleField} must be an enum`);
  }
  const adminRole = yaml.auth?.adminRole ?? "admin";
  if (!entity.fieldMap[roleField]?.enumValues?.includes(adminRole)) {
    throw new SchemaError(`auth adminRole ${adminRole} is not in ${entity.name}.${roleField} values`);
  }
  entity.fieldMap[identityField]!.unique = true;
  entity.fieldMap[identityField]!.required = true;
  entity.fieldMap[passwordField]!.required = true;
  entity.fieldMap[passwordField]!.secret = true;
  entity.fieldMap[roleField]!.writable = "admin";
  ensureEmailVerifiedField(entity);
  markPrivateAuthFields(entity, [identityField, roleField, "emailVerified"]);
  return {
    entity: entity.name,
    identityField,
    passwordField,
    roleField,
    adminRole,
    requireVerifiedEmail: yaml.auth?.requireVerifiedEmail === true,
    signup: compileSignup(yaml, entity),
  };
}

/**
 * auth.signup decides who may create an account at POST /api/v1/auth/signup.
 * When it is not set, it follows the auth entity's create policy: a public create
 * means the app already allows public signup (open); anything else is invite. An
 * explicit invite or closed cannot sit next to a public create policy, because
 * that would reopen signup through POST /api/v1/<users>.
 */
function compileSignup(yaml: AppYaml, entity: EntityAST): SignupMode {
  const publicCreate = entity.policies.create.some((policy) => policy.kind === "public");
  const mode: SignupMode = yaml.auth?.signup ?? (publicCreate ? "open" : "invite");
  if (mode !== "open" && publicCreate) {
    throw new SchemaError(
      `${entity.name}.policies.create is public, which lets anyone sign up through POST /api/v1/${entity.name}, but auth.signup is ${mode}. ` +
        "Set auth.signup: open to allow public signup, and use admin for the create policy.",
    );
  }
  return mode;
}

/** Fields only the user themself and admins see by default on the auth entity. */
function markPrivateAuthFields(entity: EntityAST, names: string[]): void {
  for (const name of names) {
    const field = entity.fieldMap[name];
    if (field && field.private === undefined) {
      field.private = true;
    }
  }
}

function ensureEmailVerifiedField(entity: EntityAST): void {
  const existing = entity.fieldMap.emailVerified;
  if (existing) {
    if (existing.type !== "boolean") {
      throw new SchemaError(`${entity.name}.emailVerified must be boolean`);
    }
    if (existing.writable === "any") {
      existing.writable = "admin";
    }
    return;
  }
  const field: FieldAST = {
    name: "emailVerified",
    type: "boolean",
    required: false,
    unique: false,
    indexed: false,
    defaultValue: false,
    secret: false,
    writable: "admin",
    description: "True after the user confirms their email, or when an admin marks them verified.",
  };
  entity.fields.push(field);
  entity.fieldMap.emailVerified = field;
}
