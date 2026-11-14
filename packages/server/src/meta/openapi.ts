import type { EntityAST, FieldAST, SchemaAST } from "@bakorin/core";

function jsonSchemaForField(field: FieldAST, write: boolean): Record<string, unknown> {
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
    case "relation":
      schema = { type: "string", format: "uuid" };
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
  const schema: Record<string, unknown> = { type: "object", properties, required };
  if (entity.description) {
    schema.description = entity.description;
  }
  return schema;
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
  const schema: Record<string, unknown> = { type: "object", properties, required };
  if (entity.description) {
    schema.description = `Writable fields for ${entity.label}`;
  }
  return schema;
}

function pascal(name: string): string {
  return name.replace(/(^[a-z])|([-_][a-z])/g, (chunk) => chunk.replace(/[-_]/, "").toUpperCase());
}

function listParameters(entity: EntityAST): unknown[] {
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
    params.push({
      name: `filter[${field.name}]`,
      in: "query",
      description: `${detail}. Equality match. Operators: filter[${field.name}][eq|neq|gt|gte|lt|lte|like|in|isnull].`,
      schema: jsonSchemaForField(field, false),
    });
  }
  return params;
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

const errorResponses = {
  400: { description: "Invalid input", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
  401: { description: "Unauthenticated", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
  403: { description: "Forbidden", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
  404: { description: "Not found", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
  409: { description: "Conflict", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
  429: { description: "Rate limited", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
};

const healthSchema = {
  type: "object",
  properties: { ok: { type: "boolean" }, app: { type: "string" } },
  required: ["ok", "app"],
};

export function buildOpenApi(ast: SchemaAST): Record<string, unknown> {
  const schemas: Record<string, unknown> = { Error: errorSchema };
  const paths: Record<string, unknown> = {
    "/health": {
      get: {
        tags: ["meta"],
        summary: "Health check",
        security: [],
        responses: {
          200: {
            description: "OK",
            content: { "application/json": { schema: healthSchema } },
          },
        },
      },
    },
    "/healthz": {
      get: {
        tags: ["meta"],
        summary: "Health check (alias of /health)",
        security: [],
        responses: {
          200: {
            description: "OK",
            content: { "application/json": { schema: healthSchema } },
          },
        },
      },
    },
    "/docs": {
      get: {
        tags: ["meta"],
        summary: "Interactive API reference",
        security: [],
        responses: { 200: { description: "HTML API docs (Swagger UI)", content: { "text/html": { schema: { type: "string" } } } } },
      },
    },
    "/api/v1/docs": {
      get: {
        tags: ["meta"],
        summary: "Interactive API reference (alias of /docs)",
        security: [],
        responses: { 200: { description: "HTML API docs (Swagger UI)", content: { "text/html": { schema: { type: "string" } } } } },
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
          401: errorResponses[401],
          403: errorResponses[403],
        },
      },
    },
    "/api/v1/backups": {
      get: {
        tags: ["backups"],
        summary: "List backups",
        description: "Admin only. Lists timestamps, sizes, and restore commands for the configured destination.",
        security: [{ bearerAuth: [] }],
        responses: {
          200: {
            description: "OK",
            content: { "application/json": { schema: { $ref: "#/components/schemas/BackupList" } } },
          },
          401: errorResponses[401],
          403: errorResponses[403],
        },
      },
      post: {
        tags: ["backups"],
        summary: "Run a live backup",
        description:
          "Admin only. Consistent SQLite snapshot of the live database plus a portable export, written to the configured destination (local or S3). Restore remains CLI-only.",
        security: [{ bearerAuth: [] }],
        responses: {
          201: {
            description: "Created",
            content: { "application/json": { schema: { type: "object", properties: { data: { $ref: "#/components/schemas/Backup" } } } } },
          },
          401: errorResponses[401],
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
        description: "Returns access and refresh tokens for the identity field on the auth entity.",
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
          400: errorResponses[400],
          401: errorResponses[401],
        },
      },
    },
    "/api/v1/auth/logout": {
      post: {
        tags: ["auth"],
        summary: "Revoke the current refresh token",
        description: "Pass refreshToken to revoke one session, or all=true with a bearer token to revoke every session for the user.",
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: { refreshToken: { type: "string" }, all: { type: "boolean" } },
              },
            },
          },
        },
        responses: {
          200: {
            description: "OK",
            content: {
              "application/json": {
                schema: { type: "object", properties: { data: { type: "object", properties: { ok: { type: "boolean" } } } } },
              },
            },
          },
          401: errorResponses[401],
        },
      },
    },
    "/api/v1/auth/me": {
      get: {
        tags: ["auth"],
        summary: "Current user",
        security: [{ bearerAuth: [] }],
        responses: {
          200: {
            description: "OK",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { data: { $ref: `#/components/schemas/${pascal(ast.auth.entity)}` } },
                },
              },
            },
          },
          401: errorResponses[401],
          404: errorResponses[404],
        },
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
          401: errorResponses[401],
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

  schemas.Backup = {
    type: "object",
    properties: {
      id: { type: "string", description: "Backup stamp" },
      createdAt: { type: "string", format: "date-time" },
      size: { type: "integer", description: "Size in bytes" },
      location: { type: "string" },
      restoreCommand: { type: "string", description: "CLI restore command. Restore is not available from the admin UI." },
    },
    required: ["id", "createdAt", "size", "location", "restoreCommand"],
  };

  schemas.BackupList = {
    type: "object",
    properties: {
      data: { type: "array", items: { $ref: "#/components/schemas/Backup" } },
    },
    required: ["data"],
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
        description: entity.description,
        security: [{ bearerAuth: [] }],
        parameters: listParameters(entity),
        responses: {
          200: { description: "OK", content: { "application/json": { schema: { $ref: `#/components/schemas/${listName}` } } } },
          401: errorResponses[401],
          403: errorResponses[403],
        },
      },
      post: {
        tags: [entity.name],
        summary: `Create ${entity.label}`,
        description: entity.description,
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
        description: entity.description,
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "expand",
            in: "query",
            schema: { type: "string" },
            description: "Comma-separated relation fields to embed under $expand.",
          },
        ],
        responses: {
          200: {
            description: "OK",
            content: { "application/json": { schema: { type: "object", properties: { data: { $ref: `#/components/schemas/${readName}` } } } } },
          },
          401: errorResponses[401],
          404: errorResponses[404],
        },
      },
      patch: {
        tags: [entity.name],
        summary: `Update ${entity.label}`,
        description: entity.description,
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
          401: errorResponses[401],
          404: errorResponses[404],
        },
      },
      delete: {
        tags: [entity.name],
        summary: `Delete ${entity.label}`,
        description: entity.description,
        security: [{ bearerAuth: [] }],
        responses: {
          200: { description: "Deleted" },
          401: errorResponses[401],
          404: errorResponses[404],
        },
      },
    };
  }

  return JSON.parse(
    JSON.stringify({
    openapi: "3.0.3",
    info: {
      title: ast.appName,
      version: ast.appVersion,
      description:
        ast.appDescription ?? `Generated from app.yaml for ${ast.appName}. Auth entity: ${ast.auth.entity}.`,
    },
    servers: [{ url: "/" }],
    tags: [
      { name: "auth", description: "Signup, login, token refresh, logout, and the current user." },
      { name: "files", description: "Upload and download files." },
      { name: "backups", description: "Admin-only live backups. Restore is CLI-only." },
      { name: "meta", description: "Health, OpenAPI, admin metadata, and docs." },
      ...ast.entities.map((entity) => ({ name: entity.name, description: entity.description ?? entity.plural })),
    ],
    paths,
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description: "Access token from /api/v1/auth/login. The docs page also reads bakorin_access from localStorage.",
        },
      },
      schemas,
    },
    }),
  ) as Record<string, unknown>;
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
