import type { MetaEntity, MetaResponse } from "./api.ts";

function ident(name: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? name : JSON.stringify(name);
}

function fieldLine(field: MetaEntity["fields"][number]): string {
  const flags: string[] = [];
  if (field.name === "id") {
    flags.push("PK");
  }
  if (field.unique && field.name !== "id") {
    flags.push("UK");
  }
  if (field.relation) {
    flags.push("FK");
  }
  const type = field.secret ? "hidden" : field.type;
  const extra = flags.length > 0 ? ` ${flags.join(",")}` : "";
  return `    ${ident(type)} ${ident(field.name)}${extra}`;
}

export function metaToMermaid(meta: MetaResponse): string {
  const lines = ["erDiagram"];
  for (const entity of meta.entities) {
    lines.push(`  ${ident(entity.name)} {`);
    for (const field of entity.fields) {
      lines.push(fieldLine(field));
    }
    lines.push("  }");
  }
  for (const entity of meta.entities) {
    for (const field of entity.fields) {
      if (!field.relation) {
        continue;
      }
      if (field.relation.many) {
        lines.push(`  ${ident(entity.name)} }o--o{ ${ident(field.relation.to)} : "${field.name} many"`);
        continue;
      }
      const onDelete = field.relation.onDelete ?? "restrict";
      lines.push(`  ${ident(entity.name)} }o--|| ${ident(field.relation.to)} : "${field.name} ${onDelete}"`);
    }
  }
  return `${lines.join("\n")}\n`;
}
