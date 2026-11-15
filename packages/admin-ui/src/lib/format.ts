export function initials(label: string): string {
  const parts = label.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return "?";
  }
  if (parts.length === 1) {
    return parts[0]!.slice(0, 2).toUpperCase();
  }
  return `${parts[0]![0]!}${parts[1]![0]!}`.toUpperCase();
}

function asDate(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value !== "string" && typeof value !== "number") {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDate(value: unknown): string {
  const date = asDate(value);
  if (!date) {
    return value === null || value === undefined ? "" : String(value);
  }
  return date.toLocaleDateString(undefined, { dateStyle: "medium" });
}

export function formatDateTime(value: unknown): string {
  const date = asDate(value);
  if (!date) {
    return value === null || value === undefined ? "" : String(value);
  }
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function emptyLabel(plural: string): string {
  const name = plural.trim() || "records";
  return `No ${name.toLowerCase()} yet`;
}
