import type { Context } from "hono";

export function requireAdmin(c: Context): Response | null {
  const actor = c.get("actor");
  const ctx = c.get("app");
  if (!actor) {
    return c.json({ error: { code: "unauthenticated", message: "sign in required" } }, 401);
  }
  if (actor.role !== ctx.ast.auth.adminRole) {
    return c.json({ error: { code: "forbidden", message: "admin only" } }, 403);
  }
  return null;
}
