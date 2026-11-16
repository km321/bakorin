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
export declare function isProtected(pathname: string, rule?: ProtectRule): boolean;
/**
 * The refresh cookie is only sent to the pass through route, so an expired session
 * is renewed there and the visitor comes back to `next`, or lands on the login page.
 */
export declare function refreshUrl(next: string, options?: Pick<GuardOptions, "loginPath" | "prefix">): string;
export declare function hasRole(user: unknown, roles: readonly string[] | undefined): boolean;
export declare function forbidden(): Response;
