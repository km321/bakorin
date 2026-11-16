/** File upload, signing, and download routes. */

import { errorResponses } from "./schemas.ts";

export function filesPaths(): Record<string, unknown> {
  return {
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
}
