import type { EntityAST, FieldAST, SchemaAST } from "@bakorin/core";

function schemaForField(field: FieldAST): Record<string, unknown> {
  switch (field.type) {
    case "boolean":
      return { type: "boolean" };
    case "integer":
      return { type: "integer" };
    case "number":
      return { type: "number" };
    case "enum":
      return { type: "string", enum: field.enumValues };
    default:
      return { type: "string" };
  }
}

function entitySchema(entity: EntityAST): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const field of entity.fields) {
    if (field.secret) {
      continue;
    }
    properties[field.name] = schemaForField(field);
    if (field.required) {
      required.push(field.name);
    }
  }
  return { type: "object", properties, required };
}

export function buildOpenApi(ast: SchemaAST): Record<string, unknown> {
  const paths: Record<string, unknown> = {
    "/api/v1/auth/signup": {
      post: { summary: "Sign up", tags: ["auth"], responses: { 201: { description: "Created" } } },
    },
    "/api/v1/auth/login": {
      post: { summary: "Log in", tags: ["auth"], responses: { 200: { description: "OK" } } },
    },
    "/api/v1/auth/refresh": {
      post: { summary: "Rotate refresh token", tags: ["auth"], responses: { 200: { description: "OK" } } },
    },
    "/api/v1/auth/logout": {
      post: { summary: "Log out", tags: ["auth"], responses: { 200: { description: "OK" } } },
    },
    "/api/v1/files": {
      post: { summary: "Upload a file", tags: ["files"], responses: { 201: { description: "Created" } } },
    },
  };
  const schemas: Record<string, unknown> = {};
  for (const entity of ast.entities) {
    schemas[entity.name] = entitySchema(entity);
    paths[`/api/v1/${entity.name}`] = {
      get: {
        summary: `List ${entity.plural}`,
        tags: [entity.name],
        parameters: [
          { name: "limit", in: "query", schema: { type: "integer" } },
          { name: "offset", in: "query", schema: { type: "integer" } },
          { name: "sort", in: "query", schema: { type: "string" } },
          { name: "expand", in: "query", schema: { type: "string" } },
        ],
        responses: { 200: { description: "OK" } },
      },
      post: { summary: `Create ${entity.label}`, tags: [entity.name], responses: { 201: { description: "Created" } } },
    };
    paths[`/api/v1/${entity.name}/{id}`] = {
      get: { summary: `Get ${entity.label}`, tags: [entity.name], responses: { 200: { description: "OK" } } },
      patch: { summary: `Update ${entity.label}`, tags: [entity.name], responses: { 200: { description: "OK" } } },
      delete: { summary: `Delete ${entity.label}`, tags: [entity.name], responses: { 200: { description: "OK" } } },
    };
  }
  return {
    openapi: "3.0.3",
    info: { title: ast.appName, version: ast.appVersion },
    paths,
    components: { schemas },
  };
}

export function metaPayload(ast: SchemaAST): Record<string, unknown> {
  return {
    app: { name: ast.appName, version: ast.appVersion },
    auth: ast.auth,
    entities: ast.entities.map((entity) => ({
      name: entity.name,
      label: entity.label,
      plural: entity.plural,
      auth: entity.auth,
      fields: entity.fields.map((field) => ({
        name: field.name,
        type: field.type,
        required: field.required,
        unique: field.unique,
        secret: field.secret,
        enumValues: field.enumValues,
        relation: field.relation,
        defaultValue: field.defaultValue ?? null,
      })),
      policies: entity.policies,
    })),
  };
}
