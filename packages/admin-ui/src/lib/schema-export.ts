import type { MetaEntity } from "./api.ts";
import { CARD_WIDTH, HEADER_HEIGHT, FIELD_HEIGHT, type SchemaLayout } from "./schema-layout.ts";

export interface SchemaExportColors {
  bg: string;
  raised: string;
  line: string;
  text: string;
  muted: string;
  accent: string;
  accentSoft: string;
}

export function readSchemaColors(root: HTMLElement): SchemaExportColors {
  const styles = getComputedStyle(root);
  const pick = (name: string, fallback: string) => styles.getPropertyValue(name).trim() || fallback;
  return {
    bg: pick("--bg", "#f4f1ec"),
    raised: pick("--bg-raised", "#fffcf8"),
    line: pick("--line", "#ddd4c7"),
    text: pick("--text", "#1c1917"),
    muted: pick("--muted", "#57534e"),
    accent: pick("--accent", "#6f4b1e"),
    accentSoft: pick("--accent-soft", "#f0e4d0"),
  };
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function layoutToSvg(layout: SchemaLayout, entities: MetaEntity[], colors: SchemaExportColors): string {
  const byName = new Map(entities.map((entity) => [entity.name, entity]));
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${layout.width}" height="${layout.height}" viewBox="0 0 ${layout.width} ${layout.height}">`,
    `<rect width="100%" height="100%" fill="${escapeXml(colors.bg)}"/>`,
    `<defs><marker id="schema-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0 0 L8 4 L0 8 z" fill="${escapeXml(colors.accent)}"/></marker></defs>`,
  ];
  for (const edge of layout.edges) {
    if (!edge.d) {
      continue;
    }
    parts.push(
      `<path d="${escapeXml(edge.d)}" fill="none" stroke="${escapeXml(colors.accent)}" stroke-width="1.4" marker-end="url(#schema-arrow)"/>`,
    );
    parts.push(
      `<text x="${edge.labelX}" y="${edge.labelY}" text-anchor="middle" font-size="10" fill="${escapeXml(colors.muted)}">${escapeXml(`${edge.field} ${edge.onDelete}`)}</text>`,
    );
  }
  for (const node of layout.nodes) {
    const entity = byName.get(node.name);
    parts.push(
      `<rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="8" fill="${escapeXml(colors.raised)}" stroke="${escapeXml(colors.line)}"/>`,
    );
    parts.push(
      `<text x="${node.x + 14}" y="${node.y + 22}" font-size="13" font-weight="600" fill="${escapeXml(colors.text)}">${escapeXml(entity?.label ?? node.name)}</text>`,
    );
    parts.push(
      `<text x="${node.x + 14}" y="${node.y + 38}" font-size="11" fill="${escapeXml(colors.muted)}">${escapeXml(node.name)}</text>`,
    );
    (entity?.fields ?? []).forEach((field, index) => {
      const y = node.y + HEADER_HEIGHT + index * FIELD_HEIGHT + 15;
      const type = field.secret ? "hidden" : field.type;
      const req = field.required ? "*" : "";
      const unique = field.unique ? " U" : "";
      parts.push(
        `<text x="${node.x + 14}" y="${y}" font-size="11" fill="${escapeXml(field.relation ? colors.accent : colors.text)}">${escapeXml(`${field.name}${req}`)}</text>`,
      );
      parts.push(
        `<text x="${node.x + CARD_WIDTH - 14}" y="${y}" text-anchor="end" font-size="10" fill="${escapeXml(colors.muted)}">${escapeXml(`${type}${unique}`)}</text>`,
      );
    });
  }
  parts.push("</svg>");
  return parts.join("");
}
