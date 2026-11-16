/** File upload, signing, and download routes. */

import { errorResponses } from "./schemas.ts";

export function filesPaths(): Record<string, unknown> {
  return {
    "/api/v1/files": {
      get: {
        tags: ["files"],
        summary: "List uploads (admin)",
        description:
          "Every upload with the records that use it. Filters: q (filename), type (image, pdf, text, other), minSize, maxSize (bytes), from, to (YYYY-MM-DD), status (orphaned, used), ids, sort (createdAt, size, filename, prefix - for descending).",
        security: [{ bearerAuth: [] }],
        responses: { 200: { description: "OK" }, 401: errorResponses[401], 403: errorResponses[403] },
      },
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
                        downloadUrl: { type: "string" },
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
    "/api/v1/files/orphans/delete": {
      post: {
        tags: ["files"],
        summary: "Delete every file no record uses (admin)",
        description: "Skips uploads from the last hour. Writes one audit entry per file.",
        security: [{ bearerAuth: [] }],
        responses: { 200: { description: "OK" }, 401: errorResponses[401], 403: errorResponses[403] },
      },
    },
    "/api/v1/files/{id}": {
      delete: {
        tags: ["files"],
        summary: "Delete a file no record uses (admin)",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          200: { description: "Deleted" },
          401: errorResponses[401],
          403: errorResponses[403],
          404: errorResponses[404],
          409: { description: "The file is still used by a record" },
        },
      },
      get: {
        tags: ["files"],
        summary: "Download a file with a signed URL",
        security: [],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          { name: "exp", in: "query", required: true, schema: { type: "integer" }, description: "Unix expiry (seconds)" },
          { name: "sig", in: "query", required: true, schema: { type: "string" }, description: "HMAC signature" },
          { name: "download", in: "query", required: false, schema: { type: "string", enum: ["1"] }, description: "1 to always download as an attachment" },
        ],
        responses: {
          200: { description: "File bytes", content: { "application/octet-stream": { schema: { type: "string", format: "binary" } } } },
          401: errorResponses[401],
          404: errorResponses[404],
        },
      },
    },
  };
}
