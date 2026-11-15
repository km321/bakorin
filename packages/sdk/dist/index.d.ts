export interface AuthTokens {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
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
    getAccessToken?: () => Promise<string | null> | string | null;
    getRefreshToken?: () => Promise<string | null> | string | null;
    setTokens?: (tokens: AuthTokens) => Promise<void> | void;
    fetch?: typeof fetch;
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
export declare function createClient<S extends Entities = Entities>(options: ClientOptions): {
    signup(body: Record<string, unknown>): Promise<{
        user: S[string];
        accessToken?: string;
        refreshToken?: string;
        expiresIn?: number;
        needsVerification?: boolean;
    }>;
    login(body: Record<string, unknown>): Promise<{
        user: S[string];
        accessToken: string;
        refreshToken: string;
        expiresIn: number;
    }>;
    logout(refreshToken?: string): Promise<void>;
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
export {};
