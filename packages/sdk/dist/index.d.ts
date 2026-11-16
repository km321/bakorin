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
}
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
type Entities = Record<string, Record<string, unknown>>;
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
export declare function createClient<S extends Entities = Entities>(options: ClientOptions): {
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
        list(query?: Query): Promise<ListResult<S[K]>>;
        get(id: string, expand?: string): Promise<S[K]>;
        create(body: Partial<S[K]>): Promise<S[K]>;
        update(id: string, body: Partial<S[K]>): Promise<S[K]>;
        delete(id: string): Promise<void>;
    };
};
export type BakorinClient<S extends Entities = Entities> = ReturnType<typeof createClient<S>>;
interface SseFrame {
    id?: string;
    event: string;
    data: string;
    retry?: number;
}
/** Parses a server sent events body. Calls onFrame for each complete event. */
export declare function readEventStream(body: ReadableStream<Uint8Array>, onFrame: (frame: SseFrame) => void): Promise<void>;
export {};
