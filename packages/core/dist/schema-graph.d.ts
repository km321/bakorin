import type { ActionName, OnDelete, SchemaAST } from "./ast.ts";
export interface SchemaGraphField {
    name: string;
    type: string;
    displayType: string;
    required: boolean;
    unique: boolean;
    secret: boolean;
    description?: string;
    relation?: {
        to: string;
        onDelete: OnDelete;
    };
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
}
export interface SchemaGraphWebhook {
    id: string;
    entity: string;
    events: string[];
}
export interface SchemaGraph {
    app: {
        name: string;
        version: string;
    };
    order: string[];
    layers: string[][];
    entities: SchemaGraphEntity[];
    relations: SchemaGraphRelation[];
    webhooks: SchemaGraphWebhook[];
}
export declare function buildSchemaGraph(ast: SchemaAST): SchemaGraph;
export declare function schemaToMermaid(graph: SchemaGraph): string;
export declare function schemaToJson(graph: SchemaGraph): string;
export declare function webhooksForEntity(graph: SchemaGraph, entityName: string): SchemaGraphWebhook[];
