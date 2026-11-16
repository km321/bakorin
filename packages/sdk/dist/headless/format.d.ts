import type { FieldSchema } from "./schema.ts";
/** Plain text for a table cell or list row. */
export declare function formatValue(field: Pick<FieldSchema, "type" | "relation"> | undefined, value: unknown, locale?: string): string;
