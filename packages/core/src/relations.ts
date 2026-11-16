import type { EntityAST, FieldAST } from "./ast.ts";

/**
 * Many to many relations (`type: relation, to: X, many: true`) have no column on
 * the entity's table. The links live in a hidden join table per field.
 */
export function isManyField(field: FieldAST | undefined): boolean {
  return Boolean(field?.relation?.many);
}

/** Fields stored as columns on the entity's own table. */
export function columnFields(entity: EntityAST): FieldAST[] {
  return entity.fields.filter((field) => !field.relation?.many);
}

/** Many to many fields of an entity. */
export function manyFields(entity: EntityAST): FieldAST[] {
  return entity.fields.filter((field) => field.relation?.many);
}

const MAX_IDENT = 63;

function fnv(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * The join table for a many to many field. Columns: source_id (this entity),
 * target_id (the related entity), position (order of the ids as sent).
 */
export function joinTableName(entity: string, field: string): string {
  const name = `_bakorin_link_${entity}_${field}`;
  if (name.length <= MAX_IDENT) {
    return name;
  }
  return `_bakorin_link_${entity.slice(0, 20)}_${field.slice(0, 20)}_${fnv(`${entity}.${field}`)}`;
}

/** Most ids one many to many field accepts in a single write. */
export const MAX_LINKS_PER_FIELD = 1000;
