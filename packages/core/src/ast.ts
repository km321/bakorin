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
}

export interface EntityAST {
  name: string;
  label: string;
  plural: string;
  display: string;
  auth: boolean;
  fields: FieldAST[];
  fieldMap: Record<string, FieldAST>;
  policies: Record<ActionName, PolicyAST[]>;
  deprecated: boolean;
}

export interface WebhookAST {
  id: string;
  entity: string | "*";
  events: Array<"create" | "update" | "delete">;
  url: string;
  secret?: string;
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
  accessTtlSeconds: number;
  refreshTtlSeconds: number;
  files: FilesRuntimeAST;
  backups: BackupRuntimeAST;
  corsOrigins: string[];
  hooksPath?: string;
}

export interface AuthAST {
  entity: string;
  identityField: string;
  passwordField: string;
  roleField: string;
  adminRole: string;
}

export interface SchemaAST {
  version: typeof SCHEMA_AST_VERSION;
  appName: string;
  appVersion: string;
  runtime: RuntimeAST;
  entities: EntityAST[];
  entityMap: Record<string, EntityAST>;
  order: string[];
  auth: AuthAST;
  webhooks: WebhookAST[];
}

export type ChangeOp = "create" | "update" | "delete";

export interface ChangeEvent {
  entity: string;
  op: ChangeOp;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  actor: { id: string; role: string } | null;
}
