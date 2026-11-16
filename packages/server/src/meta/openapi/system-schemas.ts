/** Component schemas for auth sessions and backups. */

import type { SchemaAST } from "@bakorin/core";
import { pascal } from "./schemas.ts";

export function systemSchemas(ast: SchemaAST): Record<string, unknown> {
  return {
    AuthSession: {
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
    },
    Backup: {
      type: "object",
      properties: {
        id: { type: "string", description: "Backup stamp" },
        createdAt: { type: "string", format: "date-time" },
        size: { type: "integer", description: "Size in bytes" },
        location: { type: "string" },
        restoreCommand: { type: "string", description: "CLI restore command. Restore is not available from the admin UI." },
      },
      required: ["id", "createdAt", "size", "location", "restoreCommand"],
    },
    BackupList: {
      type: "object",
      properties: {
        data: { type: "array", items: { $ref: "#/components/schemas/Backup" } },
      },
      required: ["data"],
    },
  };
}
