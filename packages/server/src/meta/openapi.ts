import type { EntityAST, FieldAST, SchemaAST } from "@bakorin/core";

function jsonSchemaForField(field: FieldAST, write: boolean): Record<string, unknown> {
  switch (field.type) {
    case "boolean":
      return { type: "boolean" };
    case "integer":
      return { type: "integer" };
    case "number":
      return { type: "number" };
    case "enum":
      return { type: "string", enum: field.enumValues };
    case "email":
      return { type: "string", format: "email" };
    case "password":
      return { type: "string", format: "password", minLength: write ? 8 : undefined };
    case "date":
      return { type: "string", format: "date" };
    case "datetime":
      return { type: "string", format: "date-time" };
    case "file":
    case "relation":
      return { type: "string", format: "uuid" };
    case "text":
      return { type: "string" };
    default: {
      const exhaustive: never = field.type;
      return exhaustive;
    }
  }
}

function entityReadSchema(entity: EntityAST): Record<string, unknown> {
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
  return { type: "object", properties, required };
}

function entityWriteSchema(entity: EntityAST, ast: SchemaAST): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const field of entity.fields) {
    if (field.name === "id" || field.name === "createdAt" || field.name === "updatedAt") {
      continue;
    }
    properties[field.name] = jsonSchemaForField(field, true);
    if (field.required && field.defaultValue === undefined && field.name !== ast.auth.passwordField) {
      required.push(field.name);
    }
  }
  return { type: "object", properties, required };
}

function pascal(name: string): string {
  return name.replace(/(^[a-z])|([-_][a-z])/g, (chunk) => chunk.replace(/[-_]/, "").toUpperCase());
}

const errorSchema = {
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

const listParams = [
  { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 50 } },
  { name: "offset", in: "query", schema: { type: "integer", minimum: 0, default: 0 } },
  { name: "sort", in: "query", schema: { type: "string" }, description: "Comma-separated fields. Prefix with - for descending." },
  { name: "expand", in: "query", schema: { type: "string" }, description: "Comma-separated relation field names to embed under $expand." },
  {
    name: "filter",
    in: "query",
    style: "deepObject",
    explode: true,
    schema: { type: "object", additionalProperties: true },
    description: "filter[field] or filter[field][eq|neq|gt|gte|lt|lte|like|in|isnull]",
  },
];

const errorResponses = {
  400: { description: "Invalid input", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
  401: { description: "Unauthenticated", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
  403: { description: "Forbidden", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
  404: { description: "Not found", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
  409: { description: "Conflict", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
  429: { description: "Rate limited", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
};

export function buildOpenApi(ast: SchemaAST): Record<string, unknown> {
  const schemas: Record<string, unknown> = { Error: errorSchema };
  const paths: Record<string, unknown> = {
    "/healthz": {
      get: {
        tags: ["meta"],
        summary: "Health check",
        security: [],
        responses: {
          200: {
            description: "OK",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { ok: { type: "boolean" }, app: { type: "string" } },
                  required: ["ok", "app"],
                },
              },
            },
          },
        },
      },
    },
    "/api/v1/openapi.json": {
      get: {
        tags: ["meta"],
        summary: "OpenAPI 3 document for this app.yaml",
        security: [],
        responses: { 200: { description: "OpenAPI document" } },
      },
    },
    "/api/v1/_meta": {
      get: {
        tags: ["meta"],
        summary: "Admin schema metadata",
        security: [{ bearerAuth: [] }],
        responses: {
          200: { description: "Schema metadata" },
          403: errorResponses[403],
        },
      },
    },
    "/api/v1/auth/signup": {
      post: {
        tags: ["auth"],
        summary: "Create an account",
        security: [],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: `#/components/schemas/${pascal(ast.auth.entity)}Write` },
            },
          },
        },
        responses: {
          201: { description: "Created", content: { "application/json": { schema: { $ref: "#/components/schemas/AuthSession" } } } },
          400: errorResponses[400],
          409: errorResponses[409],
          429: errorResponses[429],
        },
      },
    },
    "/api/v1/auth/login": {
      post: {
        tags: ["auth"],
        summary: "Log in",
        security: [],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: [ast.auth.identityField, ast.auth.passwordField],
                properties: {
                  [ast.auth.identityField]: { type: "string" },
                  [ast.auth.passwordField]: { type: "string", format: "password" },
                },
              },
            },
          },
        },
        responses: {
          200: { description: "OK", content: { "application/json": { schema: { $ref: "#/components/schemas/AuthSession" } } } },
          401: errorResponses[401],
          429: errorResponses[429],
        },
      },
    },
    "/api/v1/auth/refresh": {
      post: {
        tags: ["auth"],
        summary: "Rotate a refresh token",
        security: [],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { type: "object", required: ["refreshToken"], properties: { refreshToken: { type: "string" } } },
            },
          },
        },
        responses: {
          200: { description: "OK", content: { "application/json": { schema: { $ref: "#/components/schemas/AuthSession" } } } },
          401: errorResponses[401],
        },
      },
    },
    "/api/v1/auth/logout": {
      post: {
        tags: ["auth"],
        summary: "Revoke the current refresh token",
        requestBody: {
          content: {
            "application/json": {
              schema: { type: "object", properties: { refreshToken: { type: "string" } } },
            },
          },
        },
        responses: { 200: { description: "OK" } },
      },
    },
    "/api/v1/files": {
      post: {
        tags: ["files"],
        summary: "Upload a file",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "multipart/form-data": {
              schema: {
                type: "object",
                required: ["file"],
                properties: { file: { type: "string", format: "binary" } },
              },
            },
          },
        },
        responses: {
          201: {
            description: "Created",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    data: {
                      type: "object",
                      properties: {
                        id: { type: "string" },
                        key: { type: "string" },
                        filename: { type: "string" },
                        contentType: { type: "string" },
                        size: { type: "integer" },
                        url: { type: "string" },
                      },
                    },
                  },
                },
              },
            },
          },
          401: errorResponses[401],
        },
      },
    },
    "/api/v1/files/{id}": {
      get: {
        tags: ["files"],
        summary: "Download a file",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          200: { description: "File bytes", content: { "application/octet-stream": { schema: { type: "string", format: "binary" } } } },
          403: errorResponses[403],
          404: errorResponses[404],
        },
      },
    },
  };

  schemas.AuthSession = {
    type: "object",
    properties: {
      data: {
        type: "object",
        properties: {
          user: { $ref: `#/components/schemas/${pascal(ast.auth.entity)}` },
          accessToken: { type: "string" },
          refreshToken: { type: "string" },
          expiresIn: { type: "integer" },
        },
        required: ["accessToken", "refreshToken", "expiresIn"],
      },
    },
  };

  for (const entity of ast.entities) {
    const readName = pascal(entity.name);
    const writeName = `${readName}Write`;
    const listName = `${readName}List`;
    schemas[readName] = entityReadSchema(entity);
    schemas[writeName] = entityWriteSchema(entity, ast);
    schemas[listName] = {
      type: "object",
      properties: {
        data: { type: "array", items: { $ref: `#/components/schemas/${readName}` } },
        meta: {
          type: "object",
          properties: {
            total: { type: "integer" },
            limit: { type: "integer" },
            offset: { type: "integer" },
          },
          required: ["total", "limit", "offset"],
        },
      },
      required: ["data", "meta"],
    };
    paths[`/api/v1/${entity.name}`] = {
      get: {
        tags: [entity.name],
        summary: `List ${entity.plural}`,
        security: [{ bearerAuth: [] }],
        parameters: listParams,
        responses: {
          200: { description: "OK", content: { "application/json": { schema: { $ref: `#/components/schemas/${listName}` } } } },
          401: errorResponses[401],
          403: errorResponses[403],
        },
      },
      post: {
        tags: [entity.name],
        summary: `Create ${entity.label}`,
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: `#/components/schemas/${writeName}` } } },
        },
        responses: {
          201: {
            description: "Created",
            content: { "application/json": { schema: { type: "object", properties: { data: { $ref: `#/components/schemas/${readName}` } } } } },
          },
          400: errorResponses[400],
          401: errorResponses[401],
          403: errorResponses[403],
        },
      },
    };
    paths[`/api/v1/${entity.name}/{id}`] = {
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
      get: {
        tags: [entity.name],
        summary: `Get ${entity.label}`,
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "expand", in: "query", schema: { type: "string" } }],
        responses: {
          200: {
            description: "OK",
            content: { "application/json": { schema: { type: "object", properties: { data: { $ref: `#/components/schemas/${readName}` } } } } },
          },
          404: errorResponses[404],
        },
      },
      patch: {
        tags: [entity.name],
        summary: `Update ${entity.label}`,
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: `#/components/schemas/${writeName}` } } },
        },
        responses: {
          200: {
            description: "OK",
            content: { "application/json": { schema: { type: "object", properties: { data: { $ref: `#/components/schemas/${readName}` } } } } },
          },
          400: errorResponses[400],
          404: errorResponses[404],
        },
      },
      delete: {
        tags: [entity.name],
        summary: `Delete ${entity.label}`,
        security: [{ bearerAuth: [] }],
        responses: {
          200: { description: "Deleted" },
          404: errorResponses[404],
        },
      },
    };
  }

  return {
    openapi: "3.0.3",
    info: {
      title: ast.appName,
      version: ast.appVersion,
      description: `Generated from app.yaml for ${ast.appName}. Auth entity: ${ast.auth.entity}.`,
    },
    servers: [{ url: "/" }],
    tags: [
      { name: "auth" },
      { name: "files" },
      { name: "meta" },
      ...ast.entities.map((entity) => ({ name: entity.name })),
    ],
    paths,
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
      },
      schemas,
    },
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
      display: entity.display,
      auth: entity.auth,
      fields: entity.fields.map((field) => ({
        name: field.name,
        type: field.type,
        required: field.required,
        unique: field.unique,
        secret: field.secret,
        enumValues: field.enumValues,
        relation: field.relation
          ? {
              to: field.relation.to,
              onDelete: field.relation.onDelete,
              display: ast.entityMap[field.relation.to]?.display ?? "id",
            }
          : undefined,
        defaultValue: field.defaultValue ?? null,
      })),
      policies: entity.policies,
    })),
  };
}
