/** Admin mail, webhook, and backup routes. */

import { errorResponses } from "./schemas.ts";

export function operationsPaths(): Record<string, unknown> {
  return {
    "/api/v1/mail": {
      get: {
        tags: ["mail"],
        summary: "List mail rules and templates",
        description: "Admin only. Mail rules from app.yaml, templates in mail/, and the active driver.",
        security: [{ bearerAuth: [] }],
        responses: { 200: { description: "OK" }, 401: errorResponses[401], 403: errorResponses[403] },
      },
    },
    "/api/v1/mail/preview": {
      post: {
        tags: ["mail"],
        summary: "Render a mail template",
        description:
          "Admin only. Body: { template?, ruleId?, entity?, recordId? }. Renders against sample data or a real record (secret fields stripped). Returns subject, html, text, and a short lived frameUrl for a sandboxed preview.",
        security: [{ bearerAuth: [] }],
        responses: {
          200: { description: "OK" },
          401: errorResponses[401],
          403: errorResponses[403],
          404: errorResponses[404],
          422: { description: "Template error" },
        },
      },
    },
    "/api/v1/mail/test": {
      post: {
        tags: ["mail"],
        summary: "Send a test email to yourself",
        description: "Admin only. Same body as preview. Sends the rendered message to the signed in admin.",
        security: [{ bearerAuth: [] }],
        responses: { 201: { description: "Created" }, 401: errorResponses[401], 403: errorResponses[403] },
      },
    },
    "/api/v1/mail/deliveries": {
      get: {
        tags: ["mail"],
        summary: "List mail deliveries",
        description: "Admin only. Mail outbox rows with status, attempts, and last error.",
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "limit", in: "query", schema: { type: "integer" } },
          { name: "offset", in: "query", schema: { type: "integer" } },
          { name: "status", in: "query", schema: { type: "string", enum: ["pending", "sending", "sent", "failed"] } },
        ],
        responses: { 200: { description: "OK" }, 401: errorResponses[401], 403: errorResponses[403] },
      },
    },
    "/api/v1/mail/deliveries/{id}/retry": {
      post: {
        tags: ["mail"],
        summary: "Retry a failed email",
        description: "Admin only. Sent messages are final and are never sent again.",
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
  };
}
