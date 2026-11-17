import type { MetaEntity } from "./api.ts";
import { initials } from "./format.ts";

/** One block of the Data section. group is null for entities without admin.group. */
export interface NavGroup {
  group: string | null;
  items: MetaEntity[];
}

/** Show the filter box once the Data section lists more than this many types. */
export const NAV_FILTER_MIN = 8;

/**
 * Sidebar order for the Data section, from app.yaml admin: settings.
 * Hidden entities are left out. Entities without a group come first, with no heading,
 * so a project that sets nothing gets one plain list in app.yaml order, as before.
 * Groups follow in the order their first entity appears in app.yaml. Inside each
 * block, entities with admin.order come first (lower first), then the rest in
 * app.yaml order.
 */
export function navGroups(entities: MetaEntity[]): NavGroup[] {
  const blocks = new Map<string | null, MetaEntity[]>([[null, []]]);
  for (const entity of entities) {
    if (entity.admin?.hidden) continue;
    const group = entity.admin?.group?.trim() || null;
    if (!blocks.has(group)) blocks.set(group, []);
    blocks.get(group)!.push(entity);
  }
  const position = new Map(entities.map((entity, i) => [entity.name, i]));
  const rank = (entity: MetaEntity) => entity.admin?.order ?? Number.POSITIVE_INFINITY;
  const out: NavGroup[] = [];
  for (const [group, items] of blocks) {
    if (items.length === 0) continue;
    items.sort((a, b) => rank(a) - rank(b) || position.get(a.name)! - position.get(b.name)!);
    out.push({ group, items });
  }
  return out;
}

/** The first entity the sidebar shows, for the default page. Falls back to any entity. */
export function firstNavEntity(entities: MetaEntity[]): string {
  return navGroups(entities)[0]?.items[0]?.name ?? entities[0]?.name ?? "";
}

/** Keeps the entities whose plural, label, name, or group contains the query (any case). */
export function filterNav(groups: NavGroup[], query: string): NavGroup[] {
  const q = query.trim().toLowerCase();
  if (!q) return groups;
  return groups
    .map((block) => ({
      group: block.group,
      items: block.items.filter((entity) =>
        [entity.plural, entity.label, entity.name, block.group ?? ""].some((text) => text.toLowerCase().includes(q)),
      ),
    }))
    .filter((block) => block.items.length > 0);
}

/** The badge text: admin.icon when set, else initials of the plural label. */
export function navMark(entity: MetaEntity): string {
  return entity.admin?.icon?.trim() || initials(entity.plural);
}

/** localStorage key for the collapsed groups, one per app so projects do not share it. */
export function collapsedKey(appName: string | undefined): string {
  return `bakorin.admin.nav.collapsed:${appName ?? ""}`;
}

export function readCollapsed(appName: string | undefined): Set<string> {
  try {
    const raw = localStorage.getItem(collapsedKey(appName));
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(list) ? list.filter((item): item is string => typeof item === "string") : []);
  } catch {
    return new Set();
  }
}

export function writeCollapsed(appName: string | undefined, groups: Set<string>): void {
  try {
    localStorage.setItem(collapsedKey(appName), JSON.stringify([...groups].sort()));
  } catch {
    // private mode or full storage: collapsing still works for this visit
  }
}
