export interface AuthTokens {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
}
/** What signup answers, for new and existing emails alike. */
export interface SignupResult {
    ok: true;
    status: "check_email";
    /** True when the app requires a verified email before sign in. */
    requiresVerification: boolean;
    message: string;
}
/**
 * Thrown for an error answer from Bakorin. The message is the server's message,
 * so code that only reads error.message keeps working.
 */
export declare class BakorinRequestError extends Error {
    /** HTTP status, for example 400, 401, 403, 404, 409, or 429. */
    readonly status: number;
    /** Machine readable code from the server, for example invalid_input or conflict. */
    readonly code: string;
    /** The input field the error is about, when the server names one. */
    readonly field?: string;
    constructor(message: string, status: number, code: string, field?: string);
}
/** A stored file, as the upload route answers. url is a signed link that expires at expiresAt (seconds). */
export interface UploadedFile {
    id: string;
    key: string;
    filename: string;
    contentType: string;
    size: number;
    url: string;
    expiresAt: number;
}
export interface ListResult<T> {
    data: T[];
    meta: {
        total: number;
        limit: number;
        offset: number;
    };
}
export interface ClientOptions {
    baseUrl: string;
    /**
     * Where the Bakorin API lives under baseUrl. Default /api/v1. The browser client
     * sets this to the pass through route, for example /api/bakorin.
     */
    apiPath?: string;
    /** fetch credentials mode. The browser client uses same-origin so the httpOnly cookies go along. */
    credentials?: RequestCredentials;
    getAccessToken?: () => Promise<string | null> | string | null;
    getRefreshToken?: () => Promise<string | null> | string | null;
    setTokens?: (tokens: AuthTokens) => Promise<void> | void;
    fetch?: (input: RequestInfo | URL, init?: RequestInit) => Response | Promise<Response>;
    /**
     * Extra headers sent with every call, including token refresh and realtime. The
     * server helpers use this to name the visitor IP (see visitorHeaders).
     */
    headers?: Record<string, string>;
}
/** Headers a site sends so Bakorin keys lockouts and rate limits on the visitor, not the site server. */
export declare const PROXY_SECRET_HEADER = "x-bakorin-proxy-secret";
export declare const PROXY_CLIENT_IP_HEADER = "x-bakorin-client-ip";
/**
 * The visitor headers for a server side call, or an empty object when the IP or
 * the secret (BAKORIN_PROXY_SECRET, shared with the Bakorin server) is missing.
 */
export declare function visitorHeaders(clientIp: string | null | undefined, proxySecret: string | null | undefined): Record<string, string>;
/** BAKORIN_PROXY_SECRET from the environment, when there is one. */
export declare function envProxySecret(): string | undefined;
export interface Query {
    limit?: number;
    offset?: number;
    sort?: string;
    expand?: string;
    filter?: Record<string, string | number | boolean | {
        op: string;
        value: unknown;
    }>;
}
export type Entities = Record<string, Record<string, unknown>>;
/** One change from a realtime stream, as the signed in reader may see it. */
export interface RealtimeChange<T = Record<string, unknown>> {
    /** The event id. The SDK resumes from the last one after a reconnect. */
    eventId: string;
    entity: string;
    op: "create" | "update" | "delete";
    /** Record id. */
    id: string;
    /** The record for create and update on entities with realtime: true. Absent for delete and for realtime: ids. */
    record?: T;
    /** Commit time in milliseconds. */
    at: number;
}
export type RealtimeStatus = "connecting" | "open" | "reconnecting" | "closed";
export interface SubscribeOptions {
    /** Too many events were missed to replay (a long disconnect): refetch your list. */
    onReset?: () => void;
    onStatus?: (status: RealtimeStatus) => void;
    /** A stream error that will not be retried (unknown entity, no access). */
    onError?: (error: Error) => void;
}
export declare function createClient<S extends object = Entities>(options: ClientOptions): {
    /**
     * Live changes for an entity with realtime on in app.yaml. Every subscription on
     * one client shares a single stream, which reconnects with backoff and resumes
     * from the last event id. Returns a function that unsubscribes.
     *
     *   const stop = api.subscribe("tasks", (change) => { ... });
     */
    subscribe<K extends keyof S & string>(entity: K, handler: (change: RealtimeChange<S[K]>) => void, subscribeOptions?: SubscribeOptions): () => void;
    /** Close the shared realtime stream (subscriptions are dropped). */
    closeRealtime(): void;
    /**
     * Starts a signup. The server answers the same way whether or not the email is
     * already registered, and never returns a session: check the email, then call login().
     */
    signup(body: Record<string, unknown>): Promise<SignupResult>;
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
        /** Uploads a file (signed in users only). Use uploadFile from @bakorin/sdk/headless for progress. */
        upload(file: Blob, filename?: string): Promise<UploadedFile>;
        /** A fresh signed link for a file you uploaded (admins: any file). */
        sign(id: string): Promise<{
            url: string;
            expiresAt: number;
        }>;
    };
    /** The resolved API root, for example https://site.example/api/bakorin. Signed file links are relative to it. */
    apiUrl(path?: string): string;
    entity<K extends keyof S & string>(name: K): {
        list(query?: Query): Promise<ListResult<S[K]>>;
        get(id: string, expand?: string): Promise<S[K]>;
        create(body: Partial<S[K]>): Promise<S[K]>;
        update(id: string, body: Partial<S[K]>): Promise<S[K]>;
        delete(id: string): Promise<void>;
    };
};
export type BakorinClient<S extends object = Entities> = ReturnType<typeof createClient<S>>;
interface SseFrame {
    id?: string;
    event: string;
    data: string;
    retry?: number;
}
/** Parses a server sent events body. Calls onFrame for each complete event. */
export declare function readEventStream(body: ReadableStream<Uint8Array>, onFrame: (frame: SseFrame) => void): Promise<void>;
export {};
