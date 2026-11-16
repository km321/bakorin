/** Shared pieces of the Astro and Next.js route guards. */

export type ProtectRule = readonly string[] | ((pathname: string) => boolean);

export interface GuardOptions {
  /** Paths that need a signed in user: prefixes like "/app" (matches /app and /app/...), or a function. Default ["/app"]. */
  protect?: ProtectRule;
  /** Where to send people whose session cannot be renewed. Default /login. */
  loginPath?: string;
  /** The pass through route. Default /api/bakorin. */
  prefix?: string;
  /** Only users with one of these roles get in. Others get 403. */
  roles?: readonly string[];
}

export function isProtected(pathname: string, rule: ProtectRule = ["/app"]): boolean {
  if (typeof rule === "function") {
    return rule(pathname);
  }
  return rule.some((prefix) => {
    const clean = prefix.replace(/\/+$/, "") || "/";
    return clean === "/" || pathname === clean || pathname.startsWith(`${clean}/`);
  });
}

/**
 * The refresh cookie is only sent to the pass through route, so an expired session
 * is renewed there and the visitor comes back to `next`, or lands on the login page.
 */
export function refreshUrl(next: string, options: Pick<GuardOptions, "loginPath" | "prefix"> = {}): string {
  const prefix = (options.prefix ?? "/api/bakorin").replace(/\/+$/, "");
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/";
  const params = new URLSearchParams({ next: safeNext, fail: options.loginPath ?? "/login" });
  return `${prefix}/-/refresh?${params}`;
}

export function hasRole(user: unknown, roles: readonly string[] | undefined): boolean {
  if (!roles || roles.length === 0) {
    return true;
  }
  const role = (user as { role?: unknown } | null)?.role;
  return typeof role === "string" && roles.includes(role);
}

export function forbidden(): Response {
  return new Response("Forbidden", { status: 403, headers: { "content-type": "text/plain; charset=utf-8" } });
}
