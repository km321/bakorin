const TOKEN_KEY = "bakorin_access";
const REFRESH_KEY = "bakorin_refresh";

export interface MetaEntity {
  name: string;
  label: string;
  plural: string;
  fields: Array<{
    name: string;
    type: string;
    required: boolean;
    secret: boolean;
    enumValues?: string[];
    relation?: { to: string };
    defaultValue?: unknown;
  }>;
}

export interface MetaResponse {
  app: { name: string; version: string };
  auth: { entity: string; identityField: string; passwordField: string; adminRole: string };
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

export async function login(identityField: string, identity: string, password: string): Promise<void> {
  const response = await fetch("/api/v1/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ [identityField]: identity, password }),
  });
  const json = (await response.json()) as {
    data?: { accessToken: string; refreshToken: string };
    error?: { message: string };
  };
  if (!response.ok || !json.data) {
    throw new Error(json.error?.message ?? "login failed");
  }
  localStorage.setItem(TOKEN_KEY, json.data.accessToken);
  localStorage.setItem(REFRESH_KEY, json.data.refreshToken);
}

export function logout(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_KEY);
}

export function hasToken(): boolean {
  return Boolean(localStorage.getItem(TOKEN_KEY));
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
  params: { limit: number; offset: number; filter?: string; filterField?: string },
): Promise<{ data: Array<Record<string, unknown>>; meta: { total: number } }> {
  const search = new URLSearchParams({
    limit: String(params.limit),
    offset: String(params.offset),
    sort: "-createdAt",
  });
  if (params.filter && params.filterField) {
    search.set(`filter[${params.filterField}][like]`, params.filter);
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

export async function uploadFile(file: File): Promise<string> {
  const body = new FormData();
  body.set("file", file);
  const response = await request("/api/v1/files", { method: "POST", body });
  const json = await response.json();
  if (!response.ok) {
    throw new Error(json.error?.message ?? "upload failed");
  }
  return json.data.id as string;
}

export async function listRelated(entity: string): Promise<Array<Record<string, unknown>>> {
  const response = await request(`/api/v1/${entity}?limit=100`);
  const json = await response.json();
  if (!response.ok) {
    return [];
  }
  return json.data ?? [];
}
