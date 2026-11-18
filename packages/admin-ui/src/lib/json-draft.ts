/**
 * What a json field holds while it is being edited: the text as typed. The drawer
 * parses it on save, so a half typed value is never sent and nothing typed is lost.
 */
export class JsonDraft {
  constructor(readonly text: string) {}
}

export type JsonCheck = { ok: true; value: unknown; empty: boolean } | { ok: false; message: string; line?: number; column?: number };

/** Line and column (1 based) for a character offset in text. */
function position(text: string, offset: number): { line: number; column: number } {
  const before = text.slice(0, offset);
  const lines = before.split("\n");
  return { line: lines.length, column: (lines[lines.length - 1]?.length ?? 0) + 1 };
}

/** Parses JSON text and explains where it fails. Empty text is a valid empty value. */
export function checkJson(text: string): JsonCheck {
  if (text.trim() === "") {
    return { ok: true, value: null, empty: true };
  }
  try {
    return { ok: true, value: JSON.parse(text) as unknown, empty: false };
  } catch (error) {
    const raw = error instanceof Error ? error.message : "Invalid JSON";
    const lineCol = /line (\d+) column (\d+)/i.exec(raw);
    if (lineCol) {
      const message = raw.replace(/\s*(at|in JSON at)? position \d+/i, "").replace(/\s*\(line \d+ column \d+\)/i, "").trim();
      return { ok: false, message, line: Number(lineCol[1]), column: Number(lineCol[2]) };
    }
    const at = /position (\d+)/i.exec(raw);
    if (at) {
      const where = position(text, Number(at[1]));
      return { ok: false, message: raw.replace(/\s*(at|in JSON at)? position \d+.*$/i, ""), ...where };
    }
    return { ok: false, message: raw };
  }
}

/** The text a json field shows for a stored value. */
export function jsonText(value: unknown): string {
  if (value instanceof JsonDraft) {
    return value.text;
  }
  if (value === undefined || value === null) {
    return "";
  }
  return JSON.stringify(value, null, 2);
}
