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
 * - Names the visitor IP to Bakorin with BAKORIN_PROXY_SECRET, so lockouts and
 *   rate limits apply per visitor instead of to the whole site.
 * - Keeps the refresh cookie on the route path only. Pages refresh through
 *   GET {prefix}/-/refresh?next=/page, and GET {prefix}/-/logout signs out.
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
        /** Path of the refresh cookie. Default: the route prefix, so the token only goes to this route. */
        refreshPath?: string;
    };
    /**
     * The visitor IP. createAstroProxy uses Astro's clientAddress and createNextProxy
     * the right end of X-Forwarded-For. Bakorin trusts it only with proxySecret.
     */
    getClientIp?: (request: Request) => string | undefined;
    /** Shared with the Bakorin server as BAKORIN_PROXY_SECRET (32+ characters). Default: process.env.BAKORIN_PROXY_SECRET. */
    proxySecret?: string;
    /** Where server side errors go. Default console.error. */
    onError?: (error: unknown) => void;
    fetch?: (input: string, init: RequestInit) => Promise<Response>;
}
/**
 * The right end of X-Forwarded-For: the address the nearest proxy saw. Correct when
 * your site runs behind one platform or proxy that appends to the header (Vercel,
 * Railway, Netlify, Fly, Render, nginx). Without a proxy in front, the visitor
 * could choose this value, so pass your own getClientIp.
 */
export declare function rightmostForwardedFor(source: Request | {
    get: (name: string) => string | null;
}): string | undefined;
export declare function isSameSiteRequest(request: Request, allowedOrigins?: string[]): boolean;
export declare function createProxyHandler(options: ProxyOptions): (request: Request) => Promise<Response>;
