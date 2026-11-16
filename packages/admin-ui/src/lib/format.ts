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
  // A date field holds a calendar day (2027-01-22). Read it as that day in the
  // viewer's time zone; new Date() would read it as UTC midnight, which shows the
  // day before anywhere west of UTC.
  const day = typeof value === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null;
  if (day) {
    const local = new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3]));
    return local.toLocaleDateString(undefined, { dateStyle: "medium" });
  }
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

export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 1024) {
    return `${Math.max(0, Math.round(bytes || 0))} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/** A short label for a content type: PDF, PNG, Text, and so on. */
export function fileKind(contentType: string): string {
  const base = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (base === "application/pdf") return "PDF";
  if (base === "image/svg+xml") return "SVG";
  if (base.startsWith("image/")) return base.slice(6).toUpperCase();
  if (base === "text/plain") return "Text";
  if (base === "text/csv") return "CSV";
  if (base.startsWith("text/")) return "Text";
  if (base.includes("zip")) return "ZIP";
  if (base.includes("word")) return "Word";
  if (base.includes("sheet") || base.includes("excel")) return "Spreadsheet";
  return "File";
}

/** True for the image types the server shows inline (not SVG, which downloads). */
export function isPreviewImage(contentType: string): boolean {
  const base = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  return base === "image/png" || base === "image/jpeg" || base === "image/webp" || base === "image/gif";
}
