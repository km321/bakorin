import type { MetaEntity } from "./api.ts";

/** The fields whose value differs from the stored record. Empty secrets (passwords) are left out. */
export function changedValues(
  fields: MetaEntity["fields"],
  values: Record<string, unknown>,
  record: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    if (!(field.name in values)) {
      continue;
    }
    const next = values[field.name];
    if (field.secret && (next === undefined || next === null || next === "")) {
      continue;
    }
    const before = record[field.name] ?? null;
    if (JSON.stringify(next ?? null) !== JSON.stringify(before)) {
      out[field.name] = next;
    }
  }
  return out;
}
