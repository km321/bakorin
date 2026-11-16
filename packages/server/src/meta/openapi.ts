import { buildSchemaGraph, type SchemaAST } from "@bakorin/core";
import { addEntityPaths } from "./openapi/entity-paths.ts";
import { authPaths } from "./openapi/paths-auth.ts";
import { filesPaths } from "./openapi/paths-files.ts";
import { metaPaths } from "./openapi/paths-meta.ts";
import { operationsPaths } from "./openapi/paths-operations.ts";
import { errorSchema } from "./openapi/schemas.ts";
import { systemSchemas } from "./openapi/system-schemas.ts";

export function buildOpenApi(ast: SchemaAST): Record<string, unknown> {
  const schemas: Record<string, unknown> = { Error: errorSchema };
  const paths: Record<string, unknown> = {
    ...metaPaths(),
    ...operationsPaths(),
    ...authPaths(ast),
    ...filesPaths(),
  };

  Object.assign(schemas, systemSchemas(ast));

  addEntityPaths(ast, schemas, paths);

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
                many: Boolean(field.relation.many),
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
