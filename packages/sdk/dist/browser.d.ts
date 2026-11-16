import { type ClientOptions } from "./index.ts";
export type { RealtimeChange, RealtimeStatus, SubscribeOptions } from "./index.ts";
type Entities = Record<string, Record<string, unknown>>;
/**
 * Client for browser code that talks to the pass through route
 * (createAstroProxy or createNextProxy). Requests go to your own site with the
 * httpOnly cookies, so there are no tokens in JavaScript. One client (and one
 * realtime stream) is shared per tab and base path.
 */
export declare function createBrowserClient<S extends Entities = Entities>(options?: {
    basePath?: string;
    origin?: string;
} & Pick<ClientOptions, "fetch">): {
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
