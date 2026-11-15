export const CARD_WIDTH = 248;
export const HEADER_HEIGHT = 54;
export const FIELD_HEIGHT = 22;
export const LAYER_GAP = 96;
export const STACK_GAP = 36;
export const ORIGIN = 40;

export interface LayoutEntity {
  name: string;
  fields: Array<{ name: string }>;
}

export interface LayoutNode {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fieldY: Record<string, number>;
}

export interface LayoutEdge {
  from: string;
  field: string;
  to: string;
  onDelete: string;
  d: string;
  labelX: number;
  labelY: number;
}

export interface SchemaLayout {
  nodes: LayoutNode[];
  nodeMap: Record<string, LayoutNode>;
  edges: LayoutEdge[];
  width: number;
  height: number;
}

export function cardHeight(fieldCount: number): number {
  return HEADER_HEIGHT + fieldCount * FIELD_HEIGHT + 10;
}

export function layoutSchema(
  layers: string[][],
  entities: LayoutEntity[],
  relations: Array<{ from: string; field: string; to: string; onDelete: string }>,
): SchemaLayout {
  const byName = new Map(entities.map((entity) => [entity.name, entity]));
  const nodes: LayoutNode[] = [];
  const nodeMap: Record<string, LayoutNode> = {};
  let maxRight = ORIGIN;
  let maxBottom = ORIGIN;
  layers.forEach((layer, column) => {
    let y = ORIGIN;
    for (const name of layer) {
      const entity = byName.get(name);
      if (!entity) {
        continue;
      }
      const height = cardHeight(entity.fields.length);
      const x = ORIGIN + column * (CARD_WIDTH + LAYER_GAP);
      const fieldY: Record<string, number> = {};
      entity.fields.forEach((field, index) => {
        fieldY[field.name] = HEADER_HEIGHT + index * FIELD_HEIGHT + FIELD_HEIGHT / 2;
      });
      const node: LayoutNode = { name, x, y, width: CARD_WIDTH, height, fieldY };
      nodes.push(node);
      nodeMap[name] = node;
      y += height + STACK_GAP;
      maxRight = Math.max(maxRight, x + CARD_WIDTH);
      maxBottom = Math.max(maxBottom, node.y + height);
    }
  });
  const edges: LayoutEdge[] = relations.map((rel) => {
    const from = nodeMap[rel.from];
    const to = nodeMap[rel.to];
    if (!from || !to) {
      return { ...rel, d: "", labelX: 0, labelY: 0 };
    }
    const startY = from.y + (from.fieldY[rel.field] ?? HEADER_HEIGHT / 2);
    const endY = to.y + HEADER_HEIGHT / 2;
    const goRight = to.x >= from.x;
    const x1 = goRight ? from.x + from.width : from.x;
    const x2 = goRight ? to.x : to.x + to.width;
    const sweep = goRight ? 48 : -48;
    const c1x = x1 + sweep;
    const c2x = x2 - sweep;
    const d = `M ${x1} ${startY} C ${c1x} ${startY}, ${c2x} ${endY}, ${x2} ${endY}`;
    return {
      ...rel,
      d,
      labelX: (x1 + x2) / 2,
      labelY: (startY + endY) / 2 - 6,
    };
  });
  return {
    nodes,
    nodeMap,
    edges,
    width: maxRight + ORIGIN,
    height: maxBottom + ORIGIN,
  };
}
