import type { FieldSchema } from "./schema.ts";

/** Plain text for a table cell or list row. */
export function formatValue(field: Pick<FieldSchema, "type" | "relation"> | undefined, value: unknown, locale?: string): string {
  if (value === null || value === undefined || value === "") {
    return "";
  }
  if (field?.type === "boolean") {
    return value ? "Yes" : "No";
  }
  if (field?.type === "datetime") {
    const date = new Date(String(value));
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
  }
  if (field?.type === "date") {
    const date = new Date(`${String(value)}T00:00:00`);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString(locale, { dateStyle: "medium" });
  }
  if (Array.isArray(value)) {
    return value.map((item) => formatValue(undefined, item, locale)).join(", ");
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return String(record.name ?? record.title ?? record.email ?? record.id ?? "");
  }
  return String(value);
}
