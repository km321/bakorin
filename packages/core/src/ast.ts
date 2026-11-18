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
  | "relation"
  /** Any JSON value: TEXT checked as JSON on SQLite, jsonb on Postgres. */
  | "json"
  /** Rich text: HTML the server sanitizes against an allowlist before it is stored. */
  | "richtext";

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
    /**
     * Many to many: the field holds a list of ids, stored in a hidden join table
     * (see joinTableName). Links are removed when either record is deleted.
     */
    many?: boolean;
  };
  renameFrom?: string;
  secret: boolean;
  description?: string;
  writable: FieldWritable;
  /**
   * Private fields are left out of API responses for ordinary users. On the auth
   * entity a user still sees their own private fields; admins see everything.
   * The auth identity, role and emailVerified fields are private by default.
   */
  private?: boolean;
}

/** Fixed window request limit, counted in the database per client IP or signed in user. */
export interface RateLimitAST {
  limit: number;
  windowSeconds: number;
  /** ip: per client IP. user: per signed in user, falling back to IP when signed out. */
  per: "ip" | "user";
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
  /** Previous entity (table) name, declared in app.yaml to rename without losing data. */
  renameFrom?: string;
  /** Optional per action request limits (app.yaml rateLimit:). */
  rateLimit?: Partial<Record<ActionName, RateLimitAST>>;
  /**
   * Realtime change events over server sent events (app.yaml realtime:). Off when
   * unset. full: events carry the record as the reader may see it. ids: events
   * carry only the id and operation, for heavy tables; clients refetch.
   */
  realtime?: RealtimeMode;
  /** Admin sidebar placement (app.yaml admin:). Left out when the entity sets none. */
  admin?: EntityAdminAST;
}

/**
 * Where an entity shows in the admin sidebar. group: a heading to list it under.
 * order: its position in that list (lower first; unset keeps app.yaml order, after
 * the ordered ones). icon: 1 or 2 characters for its badge. hidden: leave it out of
 * the sidebar (it still opens by link and shows on the Schema page).
 */
export interface EntityAdminAST {
  group?: string;
  order?: number;
  icon?: string;
  hidden?: boolean;
}

export type RealtimeMode = "full" | "ids";

/**
 * memory: one process (SQLite, or a single Postgres instance).
 * postgres: fan out across instances with LISTEN/NOTIFY.
 * auto: postgres on Postgres, memory on SQLite.
 */
export type RealtimeBrokerName = "auto" | "memory" | "postgres";

export interface RealtimeRuntimeAST {
  broker: RealtimeBrokerName;
  /** Open streams allowed on one instance. */
  maxConnections: number;
  /** Open streams per signed in user (or per IP when signed out) on one instance. */
  maxPerUser: number;
  heartbeatSeconds: number;
  /** Recent events kept in memory for Last-Event-ID resume. */
  replayEvents: number;
  /** How long change rows stay in the database log for resume after a longer gap. */
  retainMinutes: number;
  /** Data queued for one client before it is dropped as too slow, in KiB. */
  maxBufferKb: number;
}

/** The read only MCP dev server at /mcp. Off unless runtime.mcp or BAKORIN_MCP turns it on. */
export interface McpRuntimeAST {
  enabled: boolean;
  /** Most rows the sample_records tool returns. */
  sampleLimit: number;
}

export const REALTIME_DEFAULTS: RealtimeRuntimeAST = {
  broker: "auto",
  maxConnections: 10_000,
  maxPerUser: 20,
  heartbeatSeconds: 15,
  replayEvents: 1000,
  retainMinutes: 10,
  maxBufferKb: 1024,
};

export const MCP_DEFAULTS: McpRuntimeAST = { enabled: false, sampleLimit: 5 };

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
export const JOB_DEFAULT_RETAIN_DAYS = 30;
export const JOB_DEFAULT_TIMEOUT_SECONDS = 300;

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

export interface JobAST {
  name: string;
  cron: string;
  handler: string;
  timezone: string;
  dryRun: boolean;
  timeoutSeconds: number;
  enabled: boolean;
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
  /** Optional upload limit (runtime.files.rateLimit). */
  rateLimit?: RateLimitAST;
}

export interface BackupRuntimeAST {
  intervalHours: number | null;
  cron?: string;
  retain: number;
  destination: string;
}

/** Optional alerts for a failing outbox or overdue backups. Off unless email or webhook is set. */
export interface AlertsRuntimeAST {
  email: string[];
  webhook?: string;
  backupMaxAgeHours: number | null;
  checkIntervalMinutes: number;
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
  /** Who can read /api/v1/openapi.json: everyone, or admins only (the production default). */
  apiDocs: "public" | "admin";
  appUrl: string;
  webhooksRetainDays: number;
  mailRetainDays: number;
  jobsRetainDays: number;
  alerts: AlertsRuntimeAST;
  /** How to find the client IP behind proxies. See TrustProxyAST. */
  trustProxy: TrustProxyAST;
  realtime: RealtimeRuntimeAST;
  mcp: McpRuntimeAST;
  /**
   * Minutes of no activity before the admin UI signs out. Null means the idle
   * timeout is off (the default).
   */
  adminIdleTimeoutMinutes: number | null;
}

/**
 * none: use the socket address and ignore X-Forwarded-For (the default).
 * hops: trust this many proxies in front of Bakorin (Railway, Fly, Render: 1).
 * cidrs: trust X-Forwarded-For entries added by proxies in these ranges.
 */
export type TrustProxyAST = { kind: "none" } | { kind: "hops"; hops: number } | { kind: "cidrs"; cidrs: string[] };

export interface AuthAST {
  entity: string;
  identityField: string;
  passwordField: string;
  roleField: string;
  adminRole: string;
  requireVerifiedEmail: boolean;
  /**
   * open: anyone can create an account at POST /api/v1/auth/signup.
   * invite: only admins add people, with invites (the default).
   * closed: no signup and no invites; admins create users in the admin.
   */
  signup: SignupMode;
}

export type SignupMode = "open" | "invite" | "closed";

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
  jobs: JobAST[];
}

export type ChangeOp = "create" | "update" | "delete";

export interface ChangeEvent {
  entity: string;
  op: ChangeOp;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  actor: { id: string; role: string } | null;
}
