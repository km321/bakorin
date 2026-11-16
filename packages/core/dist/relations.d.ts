import type { EntityAST, FieldAST } from "./ast.ts";
/**
 * Many to many relations (`type: relation, to: X, many: true`) have no column on
 * the entity's table. The links live in a hidden join table per field.
 */
export declare function isManyField(field: FieldAST | undefined): boolean;
/** Fields stored as columns on the entity's own table. */
export declare function columnFields(entity: EntityAST): FieldAST[];
/** Many to many fields of an entity. */
export declare function manyFields(entity: EntityAST): FieldAST[];
/**
 * The join table for a many to many field. Columns: source_id (this entity),
 * target_id (the related entity), position (order of the ids as sent).
 */
export declare function joinTableName(entity: string, field: string): string;
/** Most ids one many to many field accepts in a single write. */
export declare const MAX_LINKS_PER_FIELD = 1000;
