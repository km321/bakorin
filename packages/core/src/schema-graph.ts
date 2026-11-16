import type { ActionName, OnDelete, SchemaAST } from "./ast.ts";
import { describePolicy } from "./policies.ts";
import { topologicalLayers } from "./topo.ts";

export interface SchemaGraphField {
  name: string;
  type: string;
  displayType: string;
  required: boolean;
  unique: boolean;
  secret: boolean;
  description?: string;
  relation?: { to: string; onDelete: OnDelete; many?: boolean };
}

export interface SchemaGraphEntity {
  name: string;
  label: string;
  plural: string;
  display: string;
  description?: string;
  auth: boolean;
  fields: SchemaGraphField[];
  indexes: string[][];
  policies: Record<ActionName, string[]>;
}

export interface SchemaGraphRelation {
  from: string;
  field: string;
  to: string;
  onDelete: OnDelete;
  /** Many to many (a join table), not a column. */
  many?: boolean;
}

export interface SchemaGraphWebhook {
  id: string;
  entity: string;
  events: string[];
}

export interface SchemaGraph {
  app: { name: string; version: string };
  order: string[];
  layers: string[][];
  entities: SchemaGraphEntity[];
  relations: SchemaGraphRelation[];
  webhooks: SchemaGraphWebhook[];
}

export function buildSchemaGraph(ast: SchemaAST): SchemaGraph {
  const layers = topologicalLayers(ast.entities);
  const entities: SchemaGraphEntity[] = ast.entities.map((entity) => ({
    name: entity.name,
    label: entity.label,
    plural: entity.plural,
    display: entity.display,
    description: entity.description,
    auth: entity.auth,
    fields: entity.fields.map((field) => ({
      name: field.name,
      type: field.type,
      displayType: field.secret ? "hidden" : field.type,
      required: field.required,
      unique: field.unique,
      secret: field.secret,
      description: field.description,
      relation: field.relation
        ? { to: field.relation.to, onDelete: field.relation.onDelete, ...(field.relation.many ? { many: true } : {}) }
        : undefined,
    })),
    indexes: entity.indexes,
    policies: {
      read: entity.policies.read.map(describePolicy),
      create: entity.policies.create.map(describePolicy),
      update: entity.policies.update.map(describePolicy),
      delete: entity.policies.delete.map(describePolicy),
    },
  }));
  const relations: SchemaGraphRelation[] = [];
  for (const entity of ast.entities) {
    for (const field of entity.fields) {
      if (!field.relation) {
        continue;
      }
      relations.push({
        from: entity.name,
        field: field.name,
        to: field.relation.to,
        onDelete: field.relation.onDelete,
        ...(field.relation.many ? { many: true } : {}),
      });
    }
  }
  return {
    app: { name: ast.appName, version: ast.appVersion },
    order: layers.flat(),
    layers,
    entities,
    relations,
    webhooks: ast.webhooks.map((hook) => ({
      id: hook.id,
      entity: String(hook.entity),
      events: hook.events,
    })),
  };
}

function mermaidIdent(name: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? name : JSON.stringify(name);
}

export function schemaToMermaid(graph: SchemaGraph): string {
  const lines: string[] = ["erDiagram"];
  for (const entity of graph.entities) {
    lines.push(`  ${mermaidIdent(entity.name)} {`);
    for (const field of entity.fields) {
      const flags: string[] = [];
      if (field.name === "id") {
        flags.push("PK");
      }
      if (field.unique && field.name !== "id") {
        flags.push("UK");
      }
      if (field.relation && !field.relation.many) {
        flags.push("FK");
      }
      const type = mermaidIdent(field.displayType);
      const extra = flags.length > 0 ? ` ${flags.join(",")}` : "";
      lines.push(`    ${type} ${mermaidIdent(field.name)}${extra}`);
    }
    lines.push("  }");
  }
  for (const rel of graph.relations) {
    if (rel.many) {
      lines.push(`  ${mermaidIdent(rel.from)} }o--o{ ${mermaidIdent(rel.to)} : "${rel.field} many"`);
      continue;
    }
    const label = `${rel.field} ${rel.onDelete}`;
    lines.push(`  ${mermaidIdent(rel.from)} }o--|| ${mermaidIdent(rel.to)} : "${label}"`);
  }
  return `${lines.join("\n")}\n`;
}

export function schemaToJson(graph: SchemaGraph): string {
  return `${JSON.stringify(graph, null, 2)}\n`;
}

export function webhooksForEntity(graph: SchemaGraph, entityName: string): SchemaGraphWebhook[] {
  return graph.webhooks.filter((hook) => hook.entity === entityName || hook.entity === "*");
}
