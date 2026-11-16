import { type ClientOptions } from "./index.ts";
import { type ProxyOptions } from "./proxy.ts";
export { createProxyHandler, isSameSiteRequest, type ProxyOptions } from "./proxy.ts";
/**
 * Next.js helper. Pass cookie read/write from Route Handlers or Server Actions.
 * This package does not depend on next.
 */
export declare function createNextClient<S extends Record<string, Record<string, unknown>>>(options: Omit<ClientOptions, "getAccessToken" | "getRefreshToken" | "setTokens"> & {
    cookies: {
        get: (name: string) => {
            value?: string;
        } | undefined;
        set?: (name: string, value: string, opts?: object) => void;
    };
}): {
    subscribe<K extends keyof S & string>(entity: K, handler: (change: import("./index.ts").RealtimeChange<S[K]>) => void, subscribeOptions?: import("./index.ts").SubscribeOptions): () => void;
    closeRealtime(): void;
    signup(body: Record<string, unknown>): Promise<import("./index.ts").SignupResult>;
    login(body: Record<string, unknown>): Promise<{
        user: S[string];
        accessToken: string;
        refreshToken: string;
        expiresIn: number;
    }>;
    logout(refreshToken?: string, logoutOptions?: {
        all?: boolean;
    }): Promise<void>;
    me(): Promise<S[string]>;
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
        user: S[string];
        accessToken: string;
        refreshToken: string;
        expiresIn: number;
    }>;
    invite(body: {
        email: string;
        role?: string;
        name?: string;
    }): Promise<{
        user: S[string];
        email: string;
        role: string;
    }>;
    resendVerification(body?: {
        userId?: string;
        email?: string;
    }): Promise<{
        ok: boolean;
    }>;
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
