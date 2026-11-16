import type { Context } from "hono";
import { clientIp } from "../http/client-ip.ts";
import { VERIFY_TOKEN_HEADER, type VerifyContext } from "./types.ts";

/**
 * Run the project's verify hook. Returns null when the request may continue, or a
 * 403 response. A hook that throws refuses the request, so a provider outage fails
 * closed rather than letting bots through.
 */
export async function runVerifyHook(c: Context, action: VerifyContext["action"], entity: string): Promise<Response | null> {
  const ctx = c.get("app");
  const verify = ctx.hooks.verify;
  if (!verify) {
    return null;
  }
  let ok = false;
  let message = "verification failed";
  try {
    const result = await verify({
      action,
      entity,
      token: c.req.header(VERIFY_TOKEN_HEADER) ?? null,
      ip: clientIp(c),
      headers: c.req.raw.headers,
    });
    if (result === undefined || result === true) {
      ok = true;
    } else if (typeof result === "object" && result !== null) {
      ok = result.ok === true;
      if (!ok && result.message) {
        message = result.message;
      }
    }
  } catch (error) {
    ctx.monitor.captureError(error, { source: "hook", requestId: c.get("requestId"), method: c.req.method, path: c.req.path });
    console.error(`[bakorin] verify hook failed (${action} ${entity}):`, error instanceof Error ? error.message : error);
  }
  return ok ? null : Response.json({ error: { code: "verification_failed", message } }, { status: 403 });
}
