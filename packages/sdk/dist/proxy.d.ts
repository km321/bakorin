/**
 * A same-origin pass through for browser code. The browser talks to a route on
 * your site (for example /api/bakorin/...), and this handler forwards the call to
 * Bakorin with the access token from an httpOnly cookie. Tokens never reach
 * browser JavaScript.
 *
 * What it does:
 * - Rejects cross-site writes (CSRF): POST, PATCH, PUT and DELETE need an Origin
 *   that matches the site (or allowedOrigins), or Sec-Fetch-Site: same-origin.
 * - Refreshes an expired access token once with the refresh cookie and retries.
 * - Turns tokens in auth responses (login, signup verification, accept invite)
 *   into httpOnly cookies and strips them from the body.
 * - Sends the refresh cookie on logout and clears both cookies.
 * - Streams responses through without buffering, including realtime (SSE).
 *
 * Framework neutral: it takes a Request and returns a Response. See
 * createAstroProxy (./astro) and createNextProxy (./next).
 */
export interface ProxyOptions {
    /** The Bakorin server, for example http://localhost:3000 or process.env.BAKORIN_URL. */
    baseUrl: string;
    /** The route this handler is mounted on. Default /api/bakorin. */
    prefix?: string;
    /** Extra origins allowed to send writes (for example a preview domain). The site's own origin is always allowed. */
    allowedOrigins?: string[];
    /** Cookie names and attributes. */
    cookies?: {
        access?: string;
        refresh?: string;
        /** Force the Secure flag. Default: on when the request is https. */
        secure?: boolean;
        sameSite?: "Lax" | "Strict";
        /** Refresh cookie lifetime in seconds. Default 30 days (match runtime.refreshTtlSeconds). */
        refreshMaxAge?: number;
    };
    /** Forward the visitor IP as X-Forwarded-For (only when Bakorin trusts your proxy). */
    getClientIp?: (request: Request) => string | undefined;
    fetch?: (input: string, init: RequestInit) => Promise<Response>;
}
export declare function isSameSiteRequest(request: Request, allowedOrigins?: string[]): boolean;
export declare function createProxyHandler(options: ProxyOptions): (request: Request) => Promise<Response>;
