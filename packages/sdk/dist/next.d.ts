import { type ClientOptions } from "./index.ts";
import { type ProxyOptions } from "./proxy.ts";
export { createProxyHandler, isSameSiteRequest, rightmostForwardedFor, type ProxyOptions } from "./proxy.ts";
import { type GuardOptions } from "./guard.ts";
export { isProtected, refreshUrl, type GuardOptions, type ProtectRule } from "./guard.ts";
export { loadBrandingTheme } from "./headless/theme.ts";
export { isRichTextEmpty, richTextToPlain, sanitizeRichText } from "./richtext.ts";
/** The default pass through route. The refresh cookie lives on this path. */
export declare const DEFAULT_PROXY_PREFIX = "/api/bakorin";
/**
 * Next.js helper. Pass cookie read/write from Route Handlers or Server Actions.
 * This package does not depend on next.
 */
export declare function createNextClient<S extends object = Record<string, Record<string, unknown>>>(options: Omit<ClientOptions, "getAccessToken" | "getRefreshToken" | "setTokens"> & {
    cookies: {
        get: (name: string) => {
            value?: string;
        } | undefined;
        set?: (name: string, value: string, opts?: object) => void;
    };
    /** The visitor IP. Sent to Bakorin with proxySecret so lockouts and rate limits are per visitor. */
    clientIp?: string | null;
    /** Shared with the Bakorin server as BAKORIN_PROXY_SECRET. Default: process.env.BAKORIN_PROXY_SECRET. */
    proxySecret?: string;
    /** Path of the refresh cookie. Default /api/bakorin, the pass through route, so pages never see it. */
    refreshPath?: string;
}): {
    subscribe<K extends keyof S & string>(entity: K, handler: (change: import("./index.ts").RealtimeChange<S[K]>) => void, subscribeOptions?: import("./index.ts").SubscribeOptions): () => void;
    closeRealtime(): void;
    signup(body: Record<string, unknown>): Promise<import("./index.ts").SignupResult>;
    login(body: Record<string, unknown>): Promise<{
        user: S[keyof S];
        accessToken: string;
        refreshToken: string;
        expiresIn: number;
    }>;
    logout(refreshToken?: string, logoutOptions?: {
        all?: boolean;
    }): Promise<void>;
    me(): Promise<S[keyof S]>;
    forgotPassword(body: {
        email: string;
    }): Promise<{
        ok: boolean;
    }>;
    resetPassword(body: {
        token: string;
        password: string;
    }): Promise<{
        ok: boolean;
    }>;
    verifyEmail(body: {
        token: string;
    }): Promise<{
        ok: boolean;
    }>;
    acceptInvite(body: {
        token: string;
        password: string;
        name?: string;
    }): Promise<{
        user: S[keyof S];
        accessToken: string;
        refreshToken: string;
        expiresIn: number;
    }>;
    invite(body: {
        email: string;
        role?: string;
        name?: string;
    }): Promise<{
        user: S[keyof S];
        email: string;
        role: string;
    }>;
    resendVerification(body?: {
        userId?: string;
        email?: string;
    }): Promise<{
        ok: boolean;
    }>;
    files: {
        upload(file: Blob, filename?: string): Promise<import("./index.ts").UploadedFile>;
        sign(id: string): Promise<import("./index.ts").UploadedFile>;
    };
    apiUrl(path?: string): string;
    entity<K extends keyof S & string>(name: K): {
        list(query?: import("./index.ts").Query): Promise<import("./index.ts").ListResult<S[K]>>;
        get(id: string, expand?: string): Promise<S[K]>;
        create(body: Partial<S[K]>): Promise<S[K]>;
        update(id: string, body: Partial<S[K]>): Promise<S[K]>;
        delete(id: string): Promise<void>;
    };
};
/**
 * A ready made pass through route for client components. Create
 * app/api/bakorin/[...path]/route.ts with:
 *
 *   import { createNextProxy } from "@bakorin/sdk/next";
 *   export const dynamic = "force-dynamic";
 *   export const { GET, POST, PATCH, PUT, DELETE } = createNextProxy({ baseUrl: process.env.BAKORIN_URL! });
 */
export declare function createNextProxy(options: ProxyOptions): {
    GET: (request: Request) => Promise<Response>;
    POST: (request: Request) => Promise<Response>;
    PATCH: (request: Request) => Promise<Response>;
    PUT: (request: Request) => Promise<Response>;
    DELETE: (request: Request) => Promise<Response>;
    HEAD: (request: Request) => Promise<Response>;
};
/**
 * Route guard for middleware.ts. Returns a redirect (or 403) for protected paths
 * without a valid session, and undefined to let the request through.
 *
 *   // middleware.ts
 *   import { NextResponse } from "next/server";
 *   import { authMiddleware } from "@bakorin/sdk/next";
 *   const guard = authMiddleware({ baseUrl: process.env.BAKORIN_URL!, protect: ["/app"] });
 *   export async function middleware(request: Request) {
 *     return (await guard(request)) ?? NextResponse.next();
 *   }
 */
export declare function authMiddleware(options: GuardOptions & {
    baseUrl: string;
    fetch?: typeof fetch;
}): (request: Request) => Promise<Response | undefined>;
/**
 * For server components and actions: the signed in user, or a redirect through
 * the refresh route. Pass redirect from next/navigation.
 *
 *   const user = await requireUser(await api(), { redirect, next: "/app" });
 */
export declare function requireUser<U = Record<string, unknown>>(client: {
    me(): Promise<unknown>;
}, options: Omit<GuardOptions, "protect"> & {
    redirect: (url: string) => never;
    next?: string;
}): Promise<U>;
