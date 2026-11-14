export function fieldLabel(name: string): string {
  return name.replace(/Id$/, "").replace(/([a-z])([A-Z])/g, "$1 $2");
}

export function relatedLabel(row: Record<string, unknown> | null | undefined, display?: string): string {
  if (!row) {
    return "";
  }
  if (display && row[display] !== undefined && row[display] !== null && String(row[display]) !== "") {
    return String(row[display]);
  }
  for (const key of ["name", "title", "email", "company"]) {
    if (row[key] !== undefined && row[key] !== null && String(row[key]) !== "") {
      return String(row[key]);
    }
  }
  return row.id === undefined || row.id === null ? "" : String(row.id);
}
