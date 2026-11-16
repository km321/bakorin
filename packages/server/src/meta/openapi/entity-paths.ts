/** Component schemas and CRUD routes for each entity in app.yaml. */

import type { SchemaAST } from "@bakorin/core";
import { entityReadSchema, entityWriteSchema, pascal, listParameters, errorResponses } from "./schemas.ts";

export function addEntityPaths(ast: SchemaAST, schemas: Record<string, unknown>, paths: Record<string, unknown>): void {
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
}
