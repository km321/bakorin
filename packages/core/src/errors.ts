export class BakorinError extends Error {
  readonly code: string;
  readonly details: unknown;

  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = "BakorinError";
    this.code = code;
    this.details = details;
  }
}

export class SchemaError extends BakorinError {
  constructor(message: string, details?: unknown) {
    super("schema_invalid", message, details);
    this.name = "SchemaError";
  }
}

export class DiffAbortError extends BakorinError {
  constructor(message: string, details?: unknown) {
    super("diff_abort", message, details);
    this.name = "DiffAbortError";
  }
}

export class IdentError extends BakorinError {
  constructor(message: string, details?: unknown) {
    super("invalid_identifier", message, details);
    this.name = "IdentError";
  }
}
