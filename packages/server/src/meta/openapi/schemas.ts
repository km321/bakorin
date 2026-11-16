/** JSON Schema pieces shared by the OpenAPI document: fields, entity bodies, list parameters, errors. */

import { MAX_LINKS_PER_FIELD, type EntityAST, type FieldAST, type SchemaAST } from "@bakorin/core";

export function jsonSchemaForField(field: FieldAST, write: boolean): Record<string, unknown> {
  let schema: Record<string, unknown>;
  switch (field.type) {
    case "boolean":
      schema = { type: "boolean" };
      break;
    case "integer":
      schema = { type: "integer" };
      break;
    case "number":
      schema = { type: "number" };
      break;
    case "enum":
      schema = { type: "string", enum: field.enumValues };
      break;
    case "email":
      schema = { type: "string", format: "email" };
      break;
    case "password":
      schema = write ? { type: "string", format: "password", minLength: 8 } : { type: "string", format: "password" };
      break;
    case "date":
      schema = { type: "string", format: "date" };
      break;
    case "datetime":
      schema = { type: "string", format: "date-time" };
      break;
    case "file":
      schema = { type: "string", format: "uuid" };
      break;
    case "relation":
      schema = field.relation?.many
        ? { type: "array", items: { type: "string", format: "uuid" }, uniqueItems: true, maxItems: MAX_LINKS_PER_FIELD }
        : { type: "string", format: "uuid" };
      break;
    case "text":
      schema = { type: "string" };
      break;
    default: {
      const exhaustive: never = field.type;
      return exhaustive;
    }
  }
  if (field.description) {
    schema.description = field.description;
  }
  return schema;
}

export function entityReadSchema(entity: EntityAST): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const field of entity.fields) {
    if (field.secret) {
      continue;
    }
    properties[field.name] = jsonSchemaForField(field, false);
    if (field.required) {
      required.push(field.name);
    }
  }
  properties.$expand = {
    type: "object",
    additionalProperties: true,
    description: "Present when expand= lists relation fields",
  };
  const schema: Record<string, unknown> = { type: "object", properties, required };
  if (entity.description) {
    schema.description = entity.description;
  }
  return schema;
}

export function entityWriteSchema(entity: EntityAST, ast: SchemaAST): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const field of entity.fields) {
    if (field.name === "id" || field.name === "createdAt" || field.name === "updatedAt") {
      continue;
    }
    const fieldSchema = jsonSchemaForField(field, true);
    if (field.writable === "admin") {
      const extra = "Admin only. Non-admin writes that include this field return 403.";
      fieldSchema.description = fieldSchema.description ? `${fieldSchema.description} ${extra}` : extra;
    }
    if (field.writable === "none") {
      continue;
    }
    properties[field.name] = fieldSchema;
    if (field.required && field.defaultValue === undefined && field.name !== ast.auth.passwordField) {
      required.push(field.name);
    }
  }
  if (entity.name === ast.auth.entity) {
    properties.currentPassword = {
      type: "string",
      format: "password",
      description: "Required when a non-admin changes their own password via CRUD. Admins may omit it. Password changes and role changes revoke refresh tokens.",
    };
  }
  const schema: Record<string, unknown> = { type: "object", properties, required };
  if (entity.description) {
    schema.description = `Writable fields for ${entity.label}`;
  }
  return schema;
}

export function pascal(name: string): string {
  return name.replace(/(^[a-z])|([-_][a-z])/g, (chunk) => chunk.replace(/[-_]/, "").toUpperCase());
}

export function listParameters(entity: EntityAST): unknown[] {
  const relations = entity.fields.filter((field) => field.relation).map((field) => field.name);
  const sortable = entity.fields.filter((field) => !field.secret).map((field) => field.name);
  const params: unknown[] = [
    {
      name: "limit",
      in: "query",
      description: "Page size, 1-100.",
      schema: { type: "integer", minimum: 1, maximum: 100, default: 50 },
    },
    {
      name: "offset",
      in: "query",
      description: "Number of rows to skip for pagination.",
      schema: { type: "integer", minimum: 0, default: 0 },
    },
    {
      name: "sort",
      in: "query",
      description: `Comma-separated fields. Prefix with - for descending. Fields: ${sortable.join(", ")}.`,
      schema: { type: "string" },
    },
    {
      name: "expand",
      in: "query",
      description: relations.length
        ? `Comma-separated relation fields to embed under $expand: ${relations.join(", ")}.`
        : "Comma-separated relation field names to embed under $expand.",
      schema: { type: "string" },
    },
  ];
  for (const field of entity.fields) {
    if (field.secret) {
      continue;
    }
    const detail = field.description ?? `${entity.label} ${field.name}`;
    if (field.relation?.many) {
      params.push({
        name: `filter[${field.name}][has]`,
        in: "query",
        description: `${detail}. Records linked to this ${field.relation.to} id (or any of a comma separated list).`,
        schema: { type: "string" },
      });
      continue;
    }
    params.push({
      name: `filter[${field.name}]`,
      in: "query",
      description: `${detail}. Equality match. Operators: filter[${field.name}][eq|neq|gt|gte|lt|lte|like|in|isnull].`,
      schema: jsonSchemaForField(field, false),
    });
  }
  return params;
}

export const errorSchema = {
  type: "object",
  required: ["error"],
  properties: {
    error: {
      type: "object",
      required: ["code", "message"],
      properties: {
        code: { type: "string" },
        message: { type: "string" },
      },
    },
  },
};

export const errorResponses = {
  400: { description: "Invalid input", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
  401: { description: "Unauthenticated", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
  403: { description: "Forbidden", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
  404: { description: "Not found", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
  409: { description: "Conflict", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
  429: { description: "Rate limited", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
};

export const healthSchema = {
  type: "object",
  properties: { ok: { type: "boolean" }, app: { type: "string" } },
  required: ["ok", "app"],
};
