import { type ClientOptions } from "./index.ts";
import { type ProxyOptions } from "./proxy.ts";
export { createProxyHandler, isSameSiteRequest, type ProxyOptions } from "./proxy.ts";
/**
 * Astro helper. Pass Astro.cookies from a page, endpoint, or middleware.
 */
export declare function createAstroClient<S extends Record<string, Record<string, unknown>>>(options: Omit<ClientOptions, "getAccessToken" | "getRefreshToken" | "setTokens"> & {
    cookies: {
        get: (name: string) => {
            value?: string;
        } | undefined;
        set: (name: string, value: string, opts?: object) => void;
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
 * A ready made pass through route for browser code. Create
 * src/pages/api/bakorin/[...path].ts with:
 *
 *   import { createAstroProxy } from "@bakorin/sdk/astro";
 *   export const prerender = false;
 *   export const ALL = createAstroProxy({ baseUrl: import.meta.env.BAKORIN_URL });
 *
 * Then use createBrowserClient() from "@bakorin/sdk/browser" in client scripts.
 */
export declare function createAstroProxy(options: ProxyOptions): ({ request }: {
    request: Request;
}) => Promise<Response>;
