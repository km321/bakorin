import { Hono } from "hono";
import { clientIp } from "../http/client-ip.ts";
import { accessTokenHash, verifyAccessToken } from "../auth/jwt.ts";

/**
 * GET /api/v1/realtime?entities=tasks,notes
 *
 * A server sent events stream of changes the caller may read. Send the access token
 * as a Bearer header. Resume with the Last-Event-ID header (or ?lastEventId=).
 */
export function createRealtimeRoutes(): Hono {
  const app = new Hono();
  app.get("/", async (c) => {
    const ctx = c.get("app");
    if (!ctx.realtime) {
      return c.json({ error: { code: "not_found", message: "realtime is not available" } }, 404);
    }
    const actor = c.get("actor");
    const header = c.req.header("authorization");
    if (header?.startsWith("Bearer ") && !actor) {
      return c.json({ error: { code: "unauthenticated", message: "invalid or expired token" } }, 401);
    }
    let claims: { issuedAtMs?: number; expiresAtMs?: number; tokenHash?: string } = {};
    if (actor && header?.startsWith("Bearer ")) {
      const token = header.slice(7);
      const verified = await verifyAccessToken(token, ctx.ast.runtime.jwtSecret, ctx.ast.runtime.jwtSecretPrevious);
      claims = { issuedAtMs: verified.issuedAtMs, expiresAtMs: verified.expiresAtMs, tokenHash: await accessTokenHash(token) };
    }
    const rawLast = c.req.header("last-event-id") ?? c.req.query("lastEventId");
    const parsedLast = rawLast !== undefined && /^\d+$/.test(rawLast) ? Number(rawLast) : undefined;
    // Long lived stream: lift Bun's idle timeout for this request. Heartbeats keep proxies awake.
    (c.env as { timeout?: (request: Request, seconds: number) => void } | undefined)?.timeout?.(c.req.raw, 0);
    return ctx.realtime.connect({
      actor,
      ...claims,
      ip: clientIp(c),
      entities: (c.req.query("entities") ?? "").split(","),
      lastEventId: parsedLast,
      signal: c.req.raw.signal,
    });
  });
  return app;
}
