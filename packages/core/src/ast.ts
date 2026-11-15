import type { BrandingAST } from "./branding.ts";

export const SCHEMA_AST_VERSION = 1 as const;

export type DialectName = "sqlite" | "postgres";
export type FileDriver = "local" | "s3";
export type FieldTypeName =
  | "text"
  | "email"
  | "password"
  | "number"
  | "integer"
  | "boolean"
  | "date"
  | "datetime"
  | "enum"
  | "file"
  | "relation";

export type PolicyKind = "public" | "authenticated" | "admin" | "owner" | "role";

/** Who may set this field on generic CRUD create/update. Auth roleField is always "admin". */
export type FieldWritable = "any" | "admin" | "none";

export type PolicyAST =
  | { kind: "public" }
  | { kind: "authenticated" }
  | { kind: "admin" }
  | { kind: "owner"; field: string }
  | { kind: "role"; role: string };

export type ActionName = "read" | "create" | "update" | "delete";

export type OnDelete = "restrict" | "cascade" | "set_null";

export interface FieldAST {
  name: string;
  type: FieldTypeName;
  required: boolean;
  unique: boolean;
  indexed: boolean;
  defaultValue: unknown;
  enumValues?: string[];
  relation?: {
    to: string;
    onDelete: OnDelete;
  };
  renameFrom?: string;
  secret: boolean;
  description?: string;
  writable: FieldWritable;
}

export interface EntityAST {
  name: string;
  label: string;
  plural: string;
  display: string;
  description?: string;
  auth: boolean;
  fields: FieldAST[];
  fieldMap: Record<string, FieldAST>;
  policies: Record<ActionName, PolicyAST[]>;
  indexes: string[][];
  deprecated: boolean;
}

export const WEBHOOK_DEFAULT_MAX_ATTEMPTS = 10;
export const WEBHOOK_DEFAULT_TIMEOUT_MS = 10_000;
export const WEBHOOK_DEFAULT_RETAIN_DAYS = 30;

export interface WebhookAST {
  id: string;
  entity: string | "*";
  events: Array<"create" | "update" | "delete">;
  url: string;
  secret?: string;
  maxAttempts: number;
  timeoutMs: number;
}

export const MAIL_DEFAULT_MAX_ATTEMPTS = 8;
export const MAIL_DEFAULT_RETAIN_DAYS = 30;

export type MailScalar = string | number | boolean | null;

export interface MailConditionAST {
  field: string;
  op: "equals" | "not" | "in" | "notIn" | "exists";
  value?: MailScalar;
  values?: MailScalar[];
  exists?: boolean;
}

export interface MailRuleAST {
  id: string;
  entity: string;
  events: Array<"create" | "update" | "delete">;
  to: string[];
  cc: string[];
  bcc: string[];
  replyTo?: string;
  subject?: string;
  template: string;
  when: MailConditionAST[];
  changed: string[];
  expand: string[];
  maxAttempts: number;
}

export interface FilesRuntimeAST {
  driver: FileDriver;
  path: string;
  bucket?: string;
  endpoint?: string;
  accessKey?: string;
  secretKey?: string;
  region?: string;
  virtualHostedStyle: boolean;
  maxBytes: number;
  allowedMimeTypes: string[];
  signedUrlTtlSeconds: number;
}

export interface BackupRuntimeAST {
  intervalHours: number | null;
  cron?: string;
  retain: number;
  destination: string;
}

export interface RuntimeAST {
  dialect: DialectName;
  host: string;
  port: number;
  sqlitePath: string;
  postgresUrl?: string;
  jwtSecret: string;
  jwtSecretPrevious?: string;
  accessTtlSeconds: number;
  refreshTtlSeconds: number;
  files: FilesRuntimeAST;
  backups: BackupRuntimeAST;
  corsOrigins: string[];
  hooksPath?: string;
  appUrl: string;
  webhooksRetainDays: number;
  mailRetainDays: number;
}

export interface AuthAST {
  entity: string;
  identityField: string;
  passwordField: string;
  roleField: string;
  adminRole: string;
  requireVerifiedEmail: boolean;
}

export interface SchemaAST {
  version: typeof SCHEMA_AST_VERSION;
  appName: string;
  appVersion: string;
  appDescription?: string;
  /** Present only when app.yaml has a branding section. */
  branding?: BrandingAST;
  runtime: RuntimeAST;
  entities: EntityAST[];
  entityMap: Record<string, EntityAST>;
  order: string[];
  auth: AuthAST;
  webhooks: WebhookAST[];
  mail: MailRuleAST[];
}

export type ChangeOp = "create" | "update" | "delete";

export interface ChangeEvent {
  entity: string;
  op: ChangeOp;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  actor: { id: string; role: string } | null;
}
