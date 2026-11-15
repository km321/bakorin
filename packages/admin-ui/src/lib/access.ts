/**
 * Admin dashboard gate. The admin UI only renders for users whose role is the
 * project's adminRole. The server is the source of truth: GET /api/v1/_meta is
 * admin only (401 when signed out, 403 for non-admins), so the gate asks it.
 */

export type AdminAccess = "admin" | "not-admin" | "signed-out" | "error";

export type AccessFetcher = (path: string) => Promise<Response>;

export interface AccessResult {
  access: AdminAccess;
  /** Identity of the signed-in user when access is "not-admin", for the Admins only screen. */
  identity: string | null;
}

export function classifyAdminAccess(status: number): AdminAccess {
  if (status >= 200 && status < 300) {
    return "admin";
  }
  if (status === 401) {
    return "signed-out";
  }
  if (status === 403) {
    return "not-admin";
  }
  return "error";
}

/** Which top-level screen the admin app shows for a given access result. */
export function screenForAccess(access: AdminAccess): "app" | "admins-only" | "login" | "access-error" {
  switch (access) {
    case "admin":
      return "app";
    case "not-admin":
      return "admins-only";
    case "signed-out":
      return "login";
    case "error":
      return "access-error";
    default: {
      const exhaustive: never = access;
      return exhaustive;
    }
  }
}

function identityOf(user: Record<string, unknown> | undefined): string | null {
  if (!user) {
    return null;
  }
  for (const key of ["email", "name", "id"]) {
    const value = user[key];
    if (typeof value === "string" && value) {
      return value;
    }
  }
  return null;
}

export async function checkAdminAccess(fetcher: AccessFetcher): Promise<AccessResult> {
  let status: number;
  try {
    status = (await fetcher("/api/v1/_meta")).status;
  } catch {
    return { access: "error", identity: null };
  }
  const access = classifyAdminAccess(status);
  if (access !== "not-admin") {
    return { access, identity: null };
  }
  try {
    const me = await fetcher("/api/v1/auth/me");
    const json = (await me.json()) as { data?: Record<string, unknown> };
    return { access, identity: identityOf(json.data) };
  } catch {
    return { access, identity: null };
  }
}
