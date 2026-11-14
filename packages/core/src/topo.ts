import { SchemaError } from "./errors.ts";
import type { EntityAST } from "./ast.ts";

export function topologicalOrder(entities: EntityAST[]): string[] {
  const names = new Set(entities.map((entity) => entity.name));
  const incoming = new Map<string, Set<string>>();
  for (const entity of entities) {
    incoming.set(entity.name, new Set());
  }
  for (const entity of entities) {
    for (const field of entity.fields) {
      const target = field.relation?.to;
      if (!target || target === entity.name) {
        continue;
      }
      if (!names.has(target)) {
        throw new SchemaError(`entity ${entity.name} field ${field.name} relates to unknown entity ${target}`);
      }
      incoming.get(entity.name)?.add(target);
    }
  }

  const ordered: string[] = [];
  const remaining = new Set(names);
  while (remaining.size > 0) {
    const ready = [...remaining].filter((name) => (incoming.get(name)?.size ?? 0) === 0);
    if (ready.length === 0) {
      throw new SchemaError("circular relation detected among entities", { remaining: [...remaining] });
    }
    ready.sort();
    for (const name of ready) {
      ordered.push(name);
      remaining.delete(name);
      for (const deps of incoming.values()) {
        deps.delete(name);
      }
    }
  }
  return ordered;
}
