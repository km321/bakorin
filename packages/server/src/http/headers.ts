import type { MiddlewareHandler } from "hono";
import { MAIL_FRAME_CSP, MAIL_FRAME_PATH } from "../mail/routes.ts";

export function securityHeaders(): MiddlewareHandler {
  return async (c, next) => {
    await next();
    c.res.headers.set("X-Content-Type-Options", "nosniff");
    const path = new URL(c.req.url).pathname;
    const mailFrame = path === MAIL_FRAME_PATH;
    c.res.headers.set("X-Frame-Options", mailFrame ? "SAMEORIGIN" : "DENY");
    c.res.headers.set("Referrer-Policy", "no-referrer");
    c.res.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    c.res.headers.set("Cross-Origin-Opener-Policy", "same-origin");
    const docs = path === "/docs" || path.startsWith("/docs/") || path.startsWith("/api/v1/docs");
    const styleSrc = docs ? "'self' 'unsafe-inline'" : "'self'";
    const csp = `default-src 'self'; script-src 'self'; style-src ${styleSrc}; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`;
    c.res.headers.set("Content-Security-Policy", mailFrame ? MAIL_FRAME_CSP : csp);
    const proto = c.req.header("x-forwarded-proto") ?? new URL(c.req.url).protocol.replace(":", "");
    if (proto === "https") {
      c.res.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
  };
}
