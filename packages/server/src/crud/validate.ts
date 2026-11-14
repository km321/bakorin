import type { EntityAST, FieldAST } from "@bakorin/core";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class InputError extends Error {
  constructor(
    readonly field: string,
    message: string,
  ) {
    super(message);
    this.name = "InputError";
  }
}

function asString(value: unknown): string {
  return String(value);
}

export function validateValue(field: FieldAST, value: unknown, writing: boolean): unknown {
  if (value === undefined) {
    if (field.required && field.defaultValue === undefined && writing) {
      throw new InputError(field.name, `${field.name} is required`);
    }
    return undefined;
  }
  if (value === null) {
    if (field.required) {
      throw new InputError(field.name, `${field.name} is required`);
    }
    return null;
  }
  switch (field.type) {
    case "boolean":
      if (typeof value === "boolean") {
        return value;
      }
      if (value === "true" || value === "1" || value === 1) {
        return true;
      }
      if (value === "false" || value === "0" || value === 0) {
        return false;
      }
      throw new InputError(field.name, `${field.name} must be a boolean`);
    case "integer": {
      const num = typeof value === "number" ? value : Number(value);
      if (!Number.isInteger(num)) {
        throw new InputError(field.name, `${field.name} must be an integer`);
      }
      return num;
    }
    case "number": {
      const num = typeof value === "number" ? value : Number(value);
      if (!Number.isFinite(num)) {
        throw new InputError(field.name, `${field.name} must be a number`);
      }
      return num;
    }
    case "email": {
      const text = asString(value).trim();
      if (!EMAIL.test(text)) {
        throw new InputError(field.name, `${field.name} must be an email`);
      }
      return text;
    }
    case "enum": {
      const text = asString(value);
      if (!field.enumValues?.includes(text)) {
        throw new InputError(field.name, `${field.name} must be one of ${field.enumValues?.join(", ")}`);
      }
      return text;
    }
    case "date": {
      const text = asString(value);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
        throw new InputError(field.name, `${field.name} must be YYYY-MM-DD`);
      }
      return text;
    }
    case "datetime": {
      const text = asString(value);
      const time = Date.parse(text);
      if (Number.isNaN(time)) {
        throw new InputError(field.name, `${field.name} must be an ISO datetime`);
      }
      return new Date(time).toISOString();
    }
    case "password":
    case "text":
    case "file":
    case "relation":
      return asString(value);
    default: {
      const _never: never = field.type;
      return _never;
    }
  }
}

export function parseBody(
  entity: EntityAST,
  body: Record<string, unknown>,
  mode: "create" | "update",
  skipRequired: string[] = [],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const skip = new Set(skipRequired);
  for (const field of entity.fields) {
    if (field.name === "id" || field.name === "createdAt" || field.name === "updatedAt") {
      continue;
    }
    if (!(field.name in body)) {
      if (mode === "create" && field.required && field.defaultValue === undefined && !skip.has(field.name)) {
        throw new InputError(field.name, `${field.name} is required`);
      }
      if (mode === "create" && field.defaultValue !== undefined) {
        out[field.name] = field.defaultValue;
      }
      continue;
    }
    out[field.name] = validateValue(field, body[field.name], mode === "create");
  }
  return out;
}

export function publicRow(entity: EntityAST, row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of entity.fields) {
    if (field.secret) {
      continue;
    }
    if (field.name in row) {
      out[field.name] = row[field.name];
    }
  }
  return out;
}
