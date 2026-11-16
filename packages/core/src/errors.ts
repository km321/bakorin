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

/** Schema changes that remove data from the API need an explicit confirmation code. */
export class DestructiveChangeError extends BakorinError {
  readonly confirmCode: string;

  constructor(message: string, confirmCode: string, details?: unknown) {
    super("destructive_change", message, details);
    this.name = "DestructiveChangeError";
    this.confirmCode = confirmCode;
  }
}
