import { type ClientOptions } from "./index.ts";
import { type ProxyOptions } from "./proxy.ts";
import { type GuardOptions } from "./guard.ts";
export { isProtected, refreshUrl, type GuardOptions, type ProtectRule } from "./guard.ts";
import { type FieldErrors, type FormValues } from "./headless/form.ts";
import type { FieldSchema } from "./headless/schema.ts";
export { loadBrandingTheme } from "./headless/theme.ts";
export { isRichTextEmpty, richTextToPlain, sanitizeRichText } from "./richtext.ts";
export { createProxyHandler, isSameSiteRequest, rightmostForwardedFor, type ProxyOptions } from "./proxy.ts";
/** The default pass through route. The refresh cookie lives on this path. */
export declare const DEFAULT_PROXY_PREFIX = "/api/bakorin";
/**
 * Astro helper. Pass Astro.cookies from a page, endpoint, or middleware.
 */
export declare function createAstroClient<S extends object = Record<string, Record<string, unknown>>>(options: Omit<ClientOptions, "getAccessToken" | "getRefreshToken" | "setTokens"> & {
    cookies: {
        get: (name: string) => {
            value?: string;
        } | undefined;
        set: (name: string, value: string, opts?: object) => void;
    };
    /** The visitor IP (Astro.clientAddress). Sent to Bakorin with proxySecret so lockouts and rate limits are per visitor. */
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
 * A ready made pass through route for browser code. Create
 * src/pages/api/bakorin/[...path].ts with:
 *
 *   import { createAstroProxy } from "@bakorin/sdk/astro";
 *   export const prerender = false;
 *   export const ALL = createAstroProxy({ baseUrl: import.meta.env.BAKORIN_URL });
 *
 * Then use createBrowserClient() from "@bakorin/sdk/browser" in client scripts.
 */
export declare function createAstroProxy(options: ProxyOptions): (context: {
    request: Request;
    clientAddress?: string;
}) => Promise<Response>;
export interface AstroGuardContext {
    url: URL;
    request: Request;
    cookies: Parameters<typeof createAstroClient>[0]["cookies"];
    locals: Record<string, unknown>;
    redirect: (path: string, status?: 301 | 302 | 303 | 307 | 308) => Response;
    readonly clientAddress?: string;
}
/**
 * Astro middleware that signs people in or sends them to renew their session.
 * It sets Astro.locals.user (null when signed out) on every page, so components
 * like UserMenu and Gate render the right thing on the server.
 *
 *   // src/middleware.ts
 *   import { requireAuth } from "@bakorin/sdk/astro";
 *   export const onRequest = requireAuth({ baseUrl: import.meta.env.BAKORIN_URL, protect: ["/app"] });
 */
export declare function requireAuth(options: GuardOptions & {
    baseUrl: string;
    proxySecret?: string;
}): (context: AstroGuardContext, next: () => Promise<Response>) => Promise<Response>;
type FormContext = Pick<AstroGuardContext, "request" | "cookies" | "redirect"> & {
    readonly clientAddress?: string;
};
export interface FormResult<R = unknown> {
    /** Return this from the page (a redirect after success). */
    response?: Response;
    /** Field messages for the form. */
    errors?: FieldErrors;
    /** A message for the whole form. */
    error?: string;
    /** A success message. */
    message?: string;
    /** What was typed, to fill the form again (passwords are left out). */
    values?: FormValues;
    result?: R;
}
/**
 * Handles a SignInForm, SignUpForm, ForgotPasswordForm, or ResetPasswordForm post
 * without JavaScript. Call it in the page frontmatter; it does nothing for GET.
 *
 *   const form = await handleAuthForm(Astro, { baseUrl: import.meta.env.BAKORIN_URL, mode: "sign-in", redirectTo: "/app" });
 *   if (form.response) return form.response;
 */
export declare function handleAuthForm(context: FormContext, options: {
    baseUrl: string;
    mode: "sign-in" | "sign-up" | "forgot" | "reset";
    redirectTo?: string;
    fields?: readonly FieldSchema[];
    proxySecret?: string;
}): Promise<FormResult>;
export declare function defaultAuthFields(mode: "sign-in" | "sign-up" | "forgot" | "reset", identityField?: string): FieldSchema[];
/**
 * Handles a RecordForm post without JavaScript: validates by the schema, then
 * creates the record (or updates changed fields when id is set).
 */
export declare function handleRecordForm<R = Record<string, unknown>>(context: FormContext, options: {
    baseUrl: string;
    entity: string;
    fields: readonly FieldSchema[];
    id?: string;
    initial?: object;
    redirectTo?: string;
    proxySecret?: string;
}): Promise<FormResult<R>>;
