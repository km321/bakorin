/** A database constraint failure, mapped to a client error instead of a 500. */
export interface ConstraintFailure {
  status: 400 | 409;
  code: "invalid_input" | "conflict";
  message: string;
}

function errorCode(error: unknown): string {
  if (!error || typeof error !== "object") {
    return "";
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : "";
}

/**
 * SQLite (SQLITE_CONSTRAINT_*) and Postgres (SQLSTATE 23xxx) constraint errors.
 * Returns null for anything else, which stays a 500.
 */
export function constraintFailure(error: unknown, method: string): ConstraintFailure | null {
  const code = errorCode(error);
  const message = error instanceof Error ? error.message : "";
  const sqlite = code.startsWith("SQLITE_CONSTRAINT") || /constraint failed/i.test(message) ? `${code} ${message}` : "";
  const unique = code === "23505" || /UNIQUE|PRIMARYKEY/.test(sqlite);
  if (unique) {
    return { status: 409, code: "conflict", message: "a record with that value already exists" };
  }
  const foreignKey = code === "23503" || code === "23001" || /FOREIGN ?KEY/i.test(sqlite);
  if (foreignKey) {
    return method === "DELETE"
      ? { status: 409, code: "conflict", message: "other records still reference this record" }
      : { status: 400, code: "invalid_input", message: "a relation points at a record that does not exist" };
  }
  const notNull = code === "23502" || /NOTNULL/i.test(sqlite);
  if (notNull) {
    return { status: 400, code: "invalid_input", message: "a required field is missing" };
  }
  if (code === "23514" || /CHECK/.test(sqlite)) {
    return { status: 400, code: "invalid_input", message: "a value is not allowed" };
  }
  return null;
}
