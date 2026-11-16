import { SchemaError } from "./errors.ts";
import type { EntityAST } from "./ast.ts";

export function topologicalLayers(entities: EntityAST[]): string[][] {
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
      // Many to many links live in their own table, created after both entities.
      if (field.relation?.many) {
        continue;
      }
      incoming.get(entity.name)?.add(target);
    }
  }

  const layers: string[][] = [];
  const remaining = new Set(names);
  while (remaining.size > 0) {
    const ready = [...remaining].filter((name) => (incoming.get(name)?.size ?? 0) === 0);
    if (ready.length === 0) {
      throw new SchemaError("circular relation detected among entities", { remaining: [...remaining] });
    }
    ready.sort();
    layers.push(ready);
    for (const name of ready) {
      remaining.delete(name);
      for (const deps of incoming.values()) {
        deps.delete(name);
      }
    }
  }
  return layers;
}

export function topologicalOrder(entities: EntityAST[]): string[] {
  return topologicalLayers(entities).flat();
}
