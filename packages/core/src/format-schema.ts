import { ZodError, type core } from "zod";

type ZodIssue = core.$ZodIssue;
import { SchemaError } from "./errors.ts";
import { APP_YAML_TOP_LEVEL_KEYS, FIELD_TYPES } from "./yaml-schema.ts";

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const TOP_LEVEL = new Set<string>(APP_YAML_TOP_LEVEL_KEYS);
const FIELD_TYPE_SET = new Set<string>(FIELD_TYPES);

export function isAppYamlValidationError(error: unknown): boolean {
  return error instanceof SchemaError || error instanceof ZodError;
}

export function formatAppYamlError(error: unknown): string {
  if (error instanceof ZodError) {
    return formatZodError(error);
  }
  if (error instanceof SchemaError) {
    return prefixLines(error.message);
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export function formatZodError(error: ZodError): string {
  const lines = flattenZodIssues(error).map(formatIssue).flat();
  const unique = [...new Set(lines.filter((line) => line.length > 0))];
  return unique.length > 0 ? unique.join("\n") : "app.yaml: schema is invalid";
}

function prefixLines(message: string): string {
  return message
    .split("\n")
    .map((line) => {
      const trimmed = line.trimEnd();
      if (trimmed.length === 0) {
        return trimmed;
      }
      return trimmed.startsWith("app.yaml:") ? trimmed : `app.yaml: ${trimmed}`;
    })
    .join("\n");
}

function flattenZodIssues(error: ZodError): ZodIssue[] {
  const out: ZodIssue[] = [];
  for (const issue of error.issues) {
    out.push(...flattenIssue(issue, []));
  }
  return out;
}

function flattenIssue(issue: ZodIssue, prefix: PropertyKey[]): ZodIssue[] {
  const path = [...prefix, ...issue.path];
  if (issue.code === "invalid_union") {
    const children = issue.errors.flatMap((branch) => branch.flatMap((child) => flattenIssue(child, path)));
    return preferUsefulIssues(children, path);
  }
  if (issue.code === "invalid_key") {
    return issue.issues.flatMap((child) => flattenIssue(child, path));
  }
  if (issue.code === "invalid_element") {
    return issue.issues.flatMap((child) => flattenIssue(child, [...path, issue.key as PropertyKey]));
  }
  return [{ ...issue, path } as ZodIssue];
}

function preferUsefulIssues(issues: ZodIssue[], path: PropertyKey[]): ZodIssue[] {
  const ranked = issues.filter(
    (issue) =>
      issue.code === "unrecognized_keys" ||
      (issue.code === "invalid_value" && (issue.input === null || typeof issue.input !== "object")) ||
      (issue.code === "invalid_format" && issue.path.length >= path.length),
  );
  if (ranked.length > 0) {
    return ranked;
  }
  // Prefer the branch that got furthest (for example the object form of a field).
  const deepest = issues.reduce<ZodIssue | undefined>(
    (best, issue) => (!best || issue.path.length > best.path.length ? issue : best),
    undefined,
  );
  return deepest ? [deepest] : [];
}

function looksLikeEntityName(key: string): boolean {
  return IDENT.test(key) && !TOP_LEVEL.has(key);
}

function pathLabel(path: PropertyKey[]): string {
  return path.map(String).join(".");
}

function isFieldTypeIssue(issue: ZodIssue): boolean {
  if (issue.code !== "invalid_value") {
    return false;
  }
  const options = issue.values.map(String);
  return (
    options.every((option) => FIELD_TYPE_SET.has(option)) && FIELD_TYPES.every((type) => options.includes(type))
  );
}

function formatIssue(issue: ZodIssue): string[] {
  const path = pathLabel(issue.path);
  const at = path.length > 0 ? ` at ${path}` : "";
  switch (issue.code) {
    case "unrecognized_keys":
      return issue.keys.map((key) => {
        if (key === "renamedFrom" || key === "renamed_from" || key === "rename_from") {
          return `app.yaml: unknown key "${key}"${at}. Did you mean renameFrom?`;
        }
        if (issue.path.length === 0 && looksLikeEntityName(key)) {
          return `app.yaml: unknown top-level key "${key}". Did you mean to put it under "entities:"?`;
        }
        if (issue.path[0] === "entities" && issue.path.length === 2) {
          return `app.yaml: unknown key "${key}" on entity ${String(issue.path[1])}${hintEntityKeys()}`;
        }
        return `app.yaml: unknown key "${key}"${at}`;
      });
    case "invalid_value": {
      if (isFieldTypeIssue(issue)) {
        return [
          `app.yaml: unknown field type ${JSON.stringify(issue.input)}${at}. Valid types: ${FIELD_TYPES.join(", ")}`,
        ];
      }
      return [`app.yaml: invalid value ${JSON.stringify(issue.input)}${at}. Expected ${issue.values.map(String).join(", ")}`];
    }
    case "invalid_type": {
      if (issue.input === undefined) {
        if (issue.path.length === 1 && issue.path[0] === "entities") {
          return [`app.yaml: missing "entities". At least one entity is required.`];
        }
        if (issue.path.length === 1 && issue.path[0] === "app") {
          return [`app.yaml: missing "app" (needs app.name).`];
        }
        return [`app.yaml: missing "${path}"`];
      }
      if (issue.path[0] === "branding" && /Color$/.test(String(issue.path[1] ?? ""))) {
        return [`app.yaml: ${path} ${issue.message}`];
      }
      return [`app.yaml: ${path || "root"} should be ${issue.expected}, not ${receivedType(issue.input)}`];
    }
    case "too_small":
      if (issue.path.length === 1 && issue.path[0] === "entities") {
        return [`app.yaml: missing "entities". At least one entity is required.`];
      }
      return [`app.yaml: ${path || "value"} is too small`];
    case "custom":
      return [`app.yaml: ${issue.message}${at}`];
    default:
      return [`app.yaml: ${issue.message}${at}`];
  }
}

function receivedType(input: unknown): string {
  if (input === null) return "null";
  if (Array.isArray(input)) return "array";
  return typeof input;
}

function hintEntityKeys(): string {
  return ". Valid keys are label, plural, display, description, auth, renameFrom, fields, indexes, policies.";
}
