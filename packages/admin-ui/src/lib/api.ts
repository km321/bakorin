const TOKEN_KEY = "bakorin_access";
const REFRESH_KEY = "bakorin_refresh";

export interface MetaEntity {
  name: string;
  label: string;
  plural: string;
  display: string;
  description?: string;
  auth?: boolean;
  indexes?: string[][];
  policies?: Record<string, string[]>;
  fields: Array<{
    name: string;
    type: string;
    required: boolean;
    unique?: boolean;
    secret: boolean;
    writable?: "any" | "admin" | "none";
    enumValues?: string[];
    relation?: { to: string; display?: string; onDelete?: "restrict" | "cascade" | "set_null"; many?: boolean };
    defaultValue?: unknown;
    description?: string;
  }>;
}

export interface MetaWebhook {
  id: string;
  entity: string;
  events: string[];
}

export interface MetaResponse {
  app: { name: string; version: string };
  auth: {
    entity: string;
    identityField: string;
    passwordField: string;
    adminRole: string;
    roleField: string;
    requireVerifiedEmail: boolean;
    roles?: string[];
  };
  order?: string[];
  layers?: string[][];
  webhooks?: MetaWebhook[];
  entities: MetaEntity[];
}

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) {
    headers.set("authorization", `Bearer ${token}`);
  }
  if (init.body && !(init.body instanceof FormData) && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  return fetch(path, { ...init, headers });
}

async function storeSession(response: Response, fallback: string): Promise<void> {
  const json = (await response.json()) as {
    data?: { accessToken: string; refreshToken: string };
    error?: { message: string };
  };
  if (!response.ok || !json.data) {
    throw new Error(json.error?.message ?? fallback);
  }
  localStorage.setItem(TOKEN_KEY, json.data.accessToken);
  localStorage.setItem(REFRESH_KEY, json.data.refreshToken);
}

export interface SetupState {
  firstAdmin: boolean;
  /** Production: the form needs the one time setup token from the server log. */
  setupTokenRequired?: boolean;
}

export async function getSetup(): Promise<SetupState> {
  const response = await fetch("/api/v1/auth/setup");
  const json = (await response.json()) as { data?: SetupState; error?: { message: string } };
  if (!response.ok || !json.data) {
    throw new Error(json.error?.message ?? "failed to load setup");
  }
  return json.data;
}

export async function login(identityField: string, identity: string, password: string): Promise<void> {
  const response = await fetch("/api/v1/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ [identityField]: identity, password }),
  });
  await storeSession(response, "login failed");
}

export async function createFirstAdmin(email: string, password: string, setupToken?: string): Promise<void> {
  const response = await fetch("/api/v1/auth/first-admin", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(setupToken ? { email, password, setupToken } : { email, password }),
  });
  await storeSession(response, "could not create admin");
}

export function logout(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_KEY);
}

/** Revoke the refresh token on the server (best effort), then clear the local session. */
export async function signOut(): Promise<void> {
  const refreshToken = localStorage.getItem(REFRESH_KEY);
  if (refreshToken) {
    try {
      await request("/api/v1/auth/logout", { method: "POST", body: JSON.stringify({ refreshToken }) });
    } catch {
      // Clearing the local session below is what signs this browser out.
    }
  }
  logout();
}

/** Authenticated fetch for the admin access check. */
export function authedFetch(path: string): Promise<Response> {
  return request(path);
}

export function hasToken(): boolean {
  return Boolean(localStorage.getItem(TOKEN_KEY));
}

export async function getMe(): Promise<Record<string, unknown>> {
  const response = await request("/api/v1/auth/me");
  const json = (await response.json()) as { data?: Record<string, unknown>; error?: { message: string } };
  if (!response.ok || !json.data) {
    throw new Error(json.error?.message ?? "failed to load profile");
  }
  return json.data;
}

export async function getMeta(): Promise<MetaResponse> {
  const response = await request("/api/v1/_meta");
  const json = (await response.json()) as { data?: MetaResponse; error?: { message: string } };
  if (!response.ok || !json.data) {
    throw new Error(json.error?.message ?? "failed to load schema");
  }
  return json.data;
}

export async function listRecords(
  entity: string,
  params: { limit: number; offset: number; filter?: string; filterField?: string; expand?: string; sort?: string },
): Promise<{ data: Array<Record<string, unknown>>; meta: { total: number } }> {
  const search = new URLSearchParams({
    limit: String(params.limit),
    offset: String(params.offset),
    sort: params.sort ?? "-createdAt",
  });
  if (params.filter && params.filterField) {
    search.set(`filter[${params.filterField}][like]`, params.filter);
  }
  if (params.expand) {
    search.set("expand", params.expand);
  }
  const response = await request(`/api/v1/${entity}?${search.toString()}`);
  const json = await response.json();
  if (!response.ok) {
    throw new Error(json.error?.message ?? "list failed");
  }
  return json;
}

export async function saveRecord(entity: string, id: string | null, body: Record<string, unknown>): Promise<void> {
  const response = await request(id ? `/api/v1/${entity}/${id}` : `/api/v1/${entity}`, {
    method: id ? "PATCH" : "POST",
    body: JSON.stringify(body),
  });
  const json = await response.json();
  if (!response.ok) {
    throw new Error(json.error?.message ?? "save failed");
  }
}

export async function deleteRecord(entity: string, id: string): Promise<void> {
  const response = await request(`/api/v1/${entity}/${id}`, { method: "DELETE" });
  if (!response.ok) {
    const json = await response.json();
    throw new Error(json.error?.message ?? "delete failed");
  }
}

export async function uploadFile(file: File): Promise<FileDetails> {
  const body = new FormData();
  body.set("file", file);
  const response = await request("/api/v1/files", { method: "POST", body });
  const json = await response.json();
  if (!response.ok) {
    throw new Error(json.error?.message ?? "upload failed");
  }
  return {
    id: json.data.id as string,
    url: json.data.url as string,
    downloadUrl: (json.data.downloadUrl as string | undefined) ?? `${json.data.url}&download=1`,
    filename: (json.data.filename as string | undefined) ?? file.name,
    contentType: (json.data.contentType as string | undefined) ?? file.type,
    size: (json.data.size as number | undefined) ?? file.size,
    expiresAt: json.data.expiresAt as number,
  };
}

export interface BackupRecord {
  id: string;
  createdAt: string;
  size: number;
  location: string;
  restoreCommand: string;
}

export interface AuditRecord {
  id: string;
  at: string;
  action: string;
  actorId: string | null;
  actorRole: string | null;
  entity: string | null;
  recordId: string | null;
  ip: string | null;
  meta: unknown;
}

export async function listAudit(params: { limit: number; offset: number }): Promise<{
  data: AuditRecord[];
  meta: { total: number; limit: number; offset: number };
}> {
  const search = new URLSearchParams({ limit: String(params.limit), offset: String(params.offset) });
  const response = await request(`/api/v1/audit?${search.toString()}`);
  const json = (await response.json()) as {
    data?: AuditRecord[];
    meta?: { total: number; limit: number; offset: number };
    error?: { message: string };
  };
  if (!response.ok || !json.data || !json.meta) {
    throw new Error(json.error?.message ?? "failed to list audit events");
  }
  return { data: json.data, meta: json.meta };
}

export async function listBackups(): Promise<BackupRecord[]> {
  const response = await request("/api/v1/backups");
  const json = (await response.json()) as { data?: BackupRecord[]; error?: { message: string } };
  if (!response.ok || !json.data) {
    throw new Error(json.error?.message ?? "failed to list backups");
  }
  return json.data;
}

export interface WebhookConfig {
  id: string;
  entity: string;
  events: string[];
  urlHost: string;
  maxAttempts: number;
  timeoutMs: number;
}

export interface WebhookDelivery {
  id: string;
  webhookId: string | null;
  event: string;
  urlHost: string;
  status: "pending" | "delivered" | "failed" | "discarded";
  attempts: number;
  lastStatusCode: number | null;
  lastError: string | null;
  createdAt: string;
  deliveredAt: string | null;
  nextAttemptAt: string;
}

export async function listWebhooks(): Promise<WebhookConfig[]> {
  const response = await request("/api/v1/webhooks");
  const json = (await response.json()) as { data?: WebhookConfig[]; error?: { message: string } };
  if (!response.ok || !json.data) {
    throw new Error(json.error?.message ?? "failed to list webhooks");
  }
  return json.data;
}

export async function listWebhookDeliveries(params: {
  limit: number;
  offset: number;
  status?: "pending" | "delivered" | "failed" | "discarded" | "all";
}): Promise<{ data: WebhookDelivery[]; meta: { total: number; limit: number; offset: number } }> {
  const search = new URLSearchParams({ limit: String(params.limit), offset: String(params.offset) });
  if (params.status && params.status !== "all") {
    search.set("status", params.status);
  }
  const response = await request(`/api/v1/webhooks/deliveries?${search.toString()}`);
  const json = (await response.json()) as {
    data?: WebhookDelivery[];
    meta?: { total: number; limit: number; offset: number };
    error?: { message: string };
  };
  if (!response.ok || !json.data || !json.meta) {
    throw new Error(json.error?.message ?? "failed to list deliveries");
  }
  return { data: json.data, meta: json.meta };
}

export async function retryWebhookDelivery(id: string): Promise<WebhookDelivery> {
  const response = await request(`/api/v1/webhooks/deliveries/${id}/retry`, { method: "POST" });
  const json = (await response.json()) as { data?: WebhookDelivery; error?: { message: string } };
  if (!response.ok || !json.data) {
    throw new Error(json.error?.message ?? "retry failed");
  }
  return json.data;
}

export async function sendWebhookTest(id: string): Promise<WebhookDelivery> {
  const response = await request(`/api/v1/webhooks/${id}/test`, { method: "POST" });
  const json = (await response.json()) as { data?: WebhookDelivery; error?: { message: string } };
  if (!response.ok || !json.data) {
    throw new Error(json.error?.message ?? "test event failed");
  }
  return json.data;
}

/** Asks for a short-lived download link, then lets the browser download the .tar.gz. */
export async function downloadBackup(id: string): Promise<void> {
  const response = await request(`/api/v1/backups/${encodeURIComponent(id)}/link`, { method: "POST" });
  const json = (await response.json()) as { data?: { url: string }; error?: { message: string } };
  if (!response.ok || !json.data) {
    throw new Error(json.error?.message ?? "could not start the download");
  }
  const link = document.createElement("a");
  link.href = json.data.url;
  link.rel = "noopener";
  link.download = "";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

export interface QueueStats {
  pending: number;
  retrying: number;
  sending: number;
  failed: number;
  done: number;
  discarded: number;
  oldestPendingAt: string | null;
  oldestPendingAgeSeconds: number | null;
  failedItems: Array<{
    id: string;
    target: string;
    label: string;
    attempts: number;
    lastError: string | null;
    createdAt: string;
  }>;
}

export interface StatusReport {
  app: string;
  version: string;
  commit: string | null;
  runtime: string;
  startedAt: string;
  uptimeSeconds: number;
  database: { dialect: "sqlite" | "postgres"; sizeBytes: number | null };
  storage: { driver: string };
  queues: { mail: QueueStats; webhooks: QueueStats };
  errors: {
    total: number;
    recent: Array<{ at: string; name: string; message: string; requestId?: string; method?: string; path?: string; status?: number }>;
    forwarding: { sentry: boolean; webhook: boolean };
  };
  backups: { lastAt: string | null; lastLocation: string | null; intervalHours: number | null; maxAgeHours: number | null; overdue: boolean };
  alerts: { email: boolean; webhook: boolean; backupMaxAgeHours: number | null; checkIntervalMinutes: number };
  logging: "json" | "pretty" | "off";
  metrics: boolean;
  /** Absent on servers older than the realtime release. */
  realtime?: {
    enabled: boolean;
    entities: Array<{ name: string; mode: "full" | "ids" }>;
    broker: string;
    brokerHealthy: boolean;
    connections: number;
    connectionsByEntity: Record<string, number>;
    users: number;
    maxConnections: number;
    eventsTotal: number;
    deliveriesTotal: number;
    droppedSlowTotal: number;
    lastEventId: number;
  };
  mcp?: { enabled: boolean; tokenConfigured: boolean };
}

export async function getStatus(): Promise<StatusReport> {
  const response = await request("/api/v1/status");
  const json = (await response.json()) as { data?: StatusReport; error?: { message: string } };
  if (!response.ok || !json.data) {
    throw new Error(json.error?.message ?? "failed to load status");
  }
  return json.data;
}

export async function actOnDelivery(queue: "mail" | "webhooks", id: string, action: "retry" | "discard"): Promise<void> {
  const response = await request(`/api/v1/${queue}/deliveries/${encodeURIComponent(id)}/${action}`, { method: "POST" });
  if (!response.ok) {
    const json = (await response.json().catch(() => ({}))) as { error?: { message: string } };
    throw new Error(json.error?.message ?? `${action} failed`);
  }
}

export async function createBackup(): Promise<BackupRecord> {
  const response = await request("/api/v1/backups", { method: "POST" });
  const json = (await response.json()) as { data?: BackupRecord; error?: { message: string } };
  if (!response.ok || !json.data) {
    throw new Error(json.error?.message ?? "backup failed");
  }
  return json.data;
}

export async function inviteUser(body: { email: string; role?: string; name?: string }): Promise<void> {
  const response = await request("/api/v1/auth/invites", { method: "POST", body: JSON.stringify(body) });
  const json = (await response.json()) as { error?: { message: string } };
  if (!response.ok) {
    throw new Error(json.error?.message ?? "invite failed");
  }
}

export async function resendVerification(userId: string): Promise<void> {
  const response = await request("/api/v1/auth/resend-verification", {
    method: "POST",
    body: JSON.stringify({ userId }),
  });
  const json = (await response.json()) as { error?: { message: string } };
  if (!response.ok) {
    throw new Error(json.error?.message ?? "resend failed");
  }
}

export interface FileDetails {
  id: string;
  filename: string;
  contentType: string;
  size: number;
  createdAt?: string;
  /** Short lived signed link: images, PDF and text open inline. */
  url: string;
  /** The same link, always as a download. */
  downloadUrl: string;
  expiresAt: number;
}

/** A fresh signed link plus the file's name, type and size. */
export async function signFile(id: string): Promise<FileDetails> {
  const response = await request(`/api/v1/files/${encodeURIComponent(id)}/sign`, { method: "POST" });
  const json = (await response.json()) as { data?: FileDetails; error?: { message: string } };
  if (!response.ok || !json.data?.url) {
    throw new Error(json.error?.message ?? "could not load file");
  }
  return { ...json.data, downloadUrl: json.data.downloadUrl ?? `${json.data.url}&download=1` };
}

export interface FileUse {
  entity: string;
  field: string;
  id: string;
  label: string;
  removed: boolean;
}

export interface FileRow extends FileDetails {
  createdAt: string;
  createdBy: string | null;
  usedBy: FileUse[];
  orphaned: boolean;
  /** Uploaded in the last hour: may belong to a form that is still open. */
  recent: boolean;
}

export interface FileListMeta {
  total: number;
  limit: number;
  offset: number;
  files: number;
  bytes: number;
  orphaned: number;
  orphanedBytes: number;
  removable: number;
  graceMinutes: number;
}

export interface FileQuery {
  q?: string;
  type?: string;
  status?: string;
  minSize?: number;
  maxSize?: number;
  from?: string;
  to?: string;
  sort?: string;
  ids?: string[];
  limit?: number;
  offset?: number;
}

export async function listFiles(query: FileQuery = {}): Promise<{ data: FileRow[]; meta: FileListMeta }> {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    search.set(key, Array.isArray(value) ? value.join(",") : String(value));
  }
  const response = await request(`/api/v1/files${search.size ? `?${search}` : ""}`);
  const json = (await response.json()) as { data?: FileRow[]; meta?: FileListMeta; error?: { message: string } };
  if (!response.ok || !json.data || !json.meta) {
    throw new Error(json.error?.message ?? "failed to load files");
  }
  return { data: json.data, meta: json.meta };
}

export async function deleteFile(id: string): Promise<void> {
  const response = await request(`/api/v1/files/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!response.ok) {
    const json = (await response.json().catch(() => ({}))) as { error?: { message: string } };
    throw new Error(json.error?.message ?? "delete failed");
  }
}

export async function deleteOrphanFiles(): Promise<{ deleted: number; deletedBytes: number }> {
  const response = await request("/api/v1/files/orphans/delete", { method: "POST" });
  const json = (await response.json()) as { data?: { deleted: number; deletedBytes: number }; error?: { message: string } };
  if (!response.ok || !json.data) {
    throw new Error(json.error?.message ?? "delete failed");
  }
  return json.data;
}

export async function getRecord(entity: string, id: string): Promise<Record<string, unknown>> {
  const response = await request(`/api/v1/${entity}/${encodeURIComponent(id)}`);
  const json = (await response.json()) as { data?: Record<string, unknown>; error?: { message: string } };
  if (!response.ok || !json.data) {
    throw new Error(json.error?.message ?? "record not found");
  }
  return json.data;
}

export async function listRelated(entity: string): Promise<Array<Record<string, unknown>>> {
  const response = await request(`/api/v1/${entity}?limit=100`);
  const json = await response.json();
  if (!response.ok) {
    return [];
  }
  return json.data ?? [];
}

export interface MailTemplateInfo {
  name: string;
  html: boolean;
  text: boolean;
  subject: boolean;
  rules: string[];
}

export interface MailRuleInfo {
  id: string;
  entity: string;
  events: string[];
  template: string;
  to: string[];
  cc: string[];
  bcc: string[];
  replyTo: string | null;
  subject: string | null;
  when: Array<{ field: string; op: string; value?: unknown; values?: unknown[]; exists?: boolean }>;
  changed: string[];
  expand: string[];
  maxAttempts: number;
}

export interface MailSystemTemplate {
  kind: "verify" | "reset" | "invite" | "existing";
  template: string;
  html: boolean;
  text: boolean;
  subject: boolean;
}

export interface MailOverview {
  driver: string;
  layout: boolean;
  templates: MailTemplateInfo[];
  system?: MailSystemTemplate[];
  rules: MailRuleInfo[];
}

export interface MailPreviewRequest {
  template?: string;
  ruleId?: string;
  entity?: string;
  recordId?: string;
}

export interface MailPreview {
  template: string;
  ruleId: string | null;
  entity: string | null;
  recordId: string | null;
  sample: boolean;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  html: string;
  text: string;
  frameUrl: string;
}

export type MailDeliveryStatus = "pending" | "sending" | "sent" | "failed" | "discarded";

export interface MailDelivery {
  id: string;
  source: string;
  purpose?: string | null;
  ruleId: string | null;
  template: string | null;
  entity: string | null;
  recordId: string | null;
  event: string | null;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  status: MailDeliveryStatus;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  nextAttemptAt: string | null;
  sentAt: string | null;
  createdAt: string;
}

async function mailJson<T>(response: Response, fallback: string): Promise<T> {
  const json = (await response.json().catch(() => ({}))) as { data?: T; error?: { message: string } };
  if (!response.ok || json.data === undefined) {
    throw new Error(json.error?.message ?? fallback);
  }
  return json.data;
}

export async function getMailOverview(): Promise<MailOverview> {
  return mailJson<MailOverview>(await request("/api/v1/mail"), "failed to load mail");
}

export async function previewMail(body: MailPreviewRequest): Promise<MailPreview> {
  const response = await request("/api/v1/mail/preview", { method: "POST", body: JSON.stringify(body) });
  return mailJson<MailPreview>(response, "preview failed");
}

export async function sendMailTest(body: MailPreviewRequest): Promise<MailDelivery> {
  const response = await request("/api/v1/mail/test", { method: "POST", body: JSON.stringify(body) });
  return mailJson<MailDelivery>(response, "test send failed");
}

export async function listMailDeliveries(params: {
  limit: number;
  offset: number;
  status?: MailDeliveryStatus | "all";
}): Promise<{ data: MailDelivery[]; meta: { total: number; limit: number; offset: number } }> {
  const search = new URLSearchParams({ limit: String(params.limit), offset: String(params.offset) });
  if (params.status && params.status !== "all") {
    search.set("status", params.status);
  }
  const response = await request(`/api/v1/mail/deliveries?${search.toString()}`);
  const json = (await response.json()) as {
    data?: MailDelivery[];
    meta?: { total: number; limit: number; offset: number };
    error?: { message: string };
  };
  if (!response.ok || !json.data || !json.meta) {
    throw new Error(json.error?.message ?? "failed to list mail deliveries");
  }
  return { data: json.data, meta: json.meta };
}

export async function retryMailDelivery(id: string): Promise<MailDelivery> {
  const response = await request(`/api/v1/mail/deliveries/${id}/retry`, { method: "POST" });
  return mailJson<MailDelivery>(response, "retry failed");
}
