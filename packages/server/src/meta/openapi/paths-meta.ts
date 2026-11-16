/** Health, docs, OpenAPI, admin metadata, and audit routes. */

import { errorResponses, healthSchema } from "./schemas.ts";

export function metaPaths(): Record<string, unknown> {
  return {
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
  };
}
