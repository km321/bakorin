import { buildSchemaGraph, type EntityAST, type FieldAST, type SchemaAST } from "@bakorin/core";

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
    "/api/v1/audit": {
      get: {
        tags: ["audit"],
        summary: "List audit events",
        description: "Admin only. Append-only log of auth events, admin writes, and backups.",
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "limit", in: "query", schema: { type: "integer" } },
          { name: "offset", in: "query", schema: { type: "integer" } },
        ],
        responses: {
          200: { description: "OK" },
          401: errorResponses[401],
          403: errorResponses[403],
        },
      },
    },
    "/api/v1/webhooks": {
      get: {
        tags: ["webhooks"],
        summary: "List webhook endpoints",
        description: "Admin only. Configured app.yaml webhooks. Secrets are never returned.",
        security: [{ bearerAuth: [] }],
        responses: {
          200: { description: "OK" },
          401: errorResponses[401],
          403: errorResponses[403],
        },
      },
    },
    "/api/v1/webhooks/deliveries": {
      get: {
        tags: ["webhooks"],
        summary: "List webhook deliveries",
        description: "Admin only. Recent outbox rows with status, attempt count, and last error.",
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "limit", in: "query", schema: { type: "integer" } },
          { name: "offset", in: "query", schema: { type: "integer" } },
          {
            name: "status",
            in: "query",
            schema: { type: "string", enum: ["pending", "delivered", "failed"] },
          },
        ],
        responses: {
          200: { description: "OK" },
          401: errorResponses[401],
          403: errorResponses[403],
        },
      },
    },
    "/api/v1/webhooks/deliveries/{id}/retry": {
      post: {
        tags: ["webhooks"],
        summary: "Retry a failed delivery",
        description: "Admin only. Queues one more attempt for a failed outbox row.",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          200: { description: "OK" },
          401: errorResponses[401],
          403: errorResponses[403],
          404: errorResponses[404],
          409: { description: "Only failed deliveries can be retried" },
        },
      },
    },
    "/api/v1/webhooks/{id}/test": {
      post: {
        tags: ["webhooks"],
        summary: "Send a test event",
        description: "Admin only. Enqueues a synthetic payload for one configured webhook.",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          201: { description: "Created" },
          401: errorResponses[401],
          403: errorResponses[403],
          404: errorResponses[404],
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
    "/api/v1/auth/setup": {
      get: {
        tags: ["auth"],
        summary: "First-run setup status",
        description: "Public. Returns firstAdmin: true while the auth table has no admin, so the admin UI can show Create your first admin.",
        security: [],
        responses: {
          200: {
            description: "OK",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    data: {
                      type: "object",
                      properties: { firstAdmin: { type: "boolean" } },
                      required: ["firstAdmin"],
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/api/v1/auth/first-admin": {
      post: {
        tags: ["auth"],
        summary: "Create the first admin",
        description:
          "Public only while zero admins exist. Race-safe: a second call returns 409. After the first admin exists the endpoint stays closed. Alternative: BAKORIN_ADMIN_EMAIL and BAKORIN_ADMIN_PASSWORD on first boot.",
        security: [],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["email", "password"],
                properties: {
                  email: { type: "string", format: "email" },
                  password: { type: "string", format: "password", minLength: 8 },
                  name: { type: "string" },
                },
              },
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
    "/api/v1/auth/signup": {
      post: {
        tags: ["auth"],
        summary: "Create an account",
        description:
          "Public signup. The auth role field is ignored and forced to the non-admin default. Prefer this over generic CRUD create on the auth entity. Sends a verification email. If auth.requireVerifiedEmail is true, no session tokens are returned until the address is verified.",
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
          403: errorResponses[403],
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
    "/api/v1/auth/forgot-password": {
      post: {
        tags: ["auth"],
        summary: "Request a password reset",
        description: "Always returns 200. Does not reveal whether the account exists. Rate limited. Sends a one-hour single-use link.",
        security: [],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { type: "object", properties: { email: { type: "string", format: "email" } }, required: ["email"] },
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
          429: errorResponses[429],
        },
      },
    },
    "/api/v1/auth/reset-password": {
      post: {
        tags: ["auth"],
        summary: "Reset password with a token",
        description: "Consumes a hashed one-hour token and revokes every refresh token for that user.",
        security: [],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["token", "password"],
                properties: { token: { type: "string" }, password: { type: "string", format: "password", minLength: 8 } },
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
          400: errorResponses[400],
        },
      },
    },
    "/api/v1/auth/verify-email": {
      post: {
        tags: ["auth"],
        summary: "Verify email with a token",
        security: [],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { type: "object", required: ["token"], properties: { token: { type: "string" } } },
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
          400: errorResponses[400],
        },
      },
    },
    "/api/v1/auth/resend-verification": {
      post: {
        tags: ["auth"],
        summary: "Resend a verification email",
        description: "Signed-in users resend for themselves. Admins may pass userId. Passing only email does not reveal whether the account exists.",
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: { userId: { type: "string" }, email: { type: "string", format: "email" } },
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
          403: errorResponses[403],
          429: errorResponses[429],
        },
      },
    },
    "/api/v1/auth/invites": {
      post: {
        tags: ["auth"],
        summary: "Invite a user",
        description: "Admin only. Creates the account with the given role and emails a link to set a password.",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["email"],
                properties: {
                  email: { type: "string", format: "email" },
                  role: { type: "string" },
                  name: { type: "string" },
                },
              },
            },
          },
        },
        responses: {
          201: { description: "Created", content: { "application/json": { schema: { $ref: "#/components/schemas/AuthSession" } } } },
          400: errorResponses[400],
          401: errorResponses[401],
          403: errorResponses[403],
          409: errorResponses[409],
        },
      },
    },
    "/api/v1/auth/accept-invite": {
      post: {
        tags: ["auth"],
        summary: "Accept an invite and set a password",
        security: [],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["token", "password"],
                properties: {
                  token: { type: "string" },
                  password: { type: "string", format: "password", minLength: 8 },
                  name: { type: "string" },
                },
              },
            },
          },
        },
        responses: {
          200: { description: "OK", content: { "application/json": { schema: { $ref: "#/components/schemas/AuthSession" } } } },
          400: errorResponses[400],
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
                        expiresAt: { type: "integer" },
                      },
                    },
                  },
                },
              },
            },
          },
          400: errorResponses[400],
          401: errorResponses[401],
        },
      },
    },
    "/api/v1/files/{id}/sign": {
      post: {
        tags: ["files"],
        summary: "Issue a short-lived signed URL",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          200: { description: "OK" },
          401: errorResponses[401],
          403: errorResponses[403],
          404: errorResponses[404],
        },
      },
    },
    "/api/v1/files/{id}": {
      get: {
        tags: ["files"],
        summary: "Download a file with a signed URL",
        security: [],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          { name: "exp", in: "query", required: true, schema: { type: "integer" }, description: "Unix expiry (seconds)" },
          { name: "sig", in: "query", required: true, schema: { type: "string" }, description: "HMAC signature" },
        ],
        responses: {
          200: { description: "File bytes", content: { "application/octet-stream": { schema: { type: "string", format: "binary" } } } },
          401: errorResponses[401],
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
          needsVerification: { type: "boolean" },
        },
        required: ["user"],
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
      { name: "webhooks", description: "Admin-only webhook configuration and delivery log." },
      { name: "audit", description: "Admin-only append-only audit log." },
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
  const graph = buildSchemaGraph(ast);
  return {
    app: { name: ast.appName, version: ast.appVersion },
    auth: {
      ...ast.auth,
      roles: ast.entityMap[ast.auth.entity]?.fieldMap[ast.auth.roleField]?.enumValues ?? [],
    },
    order: graph.order,
    layers: graph.layers,
    webhooks: graph.webhooks,
    entities: ast.entities.map((entity) => {
      const graphed = graph.entities.find((item) => item.name === entity.name);
      return {
        name: entity.name,
        label: entity.label,
        plural: entity.plural,
        display: entity.display,
        description: entity.description,
        auth: entity.auth,
        indexes: entity.indexes,
        fields: entity.fields.map((field) => ({
          name: field.name,
          type: field.type,
          required: field.required,
          unique: field.unique,
          secret: field.secret,
          writable: field.writable,
          description: field.description,
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
        policies: graphed?.policies ?? entity.policies,
      };
    }),
  };
}
