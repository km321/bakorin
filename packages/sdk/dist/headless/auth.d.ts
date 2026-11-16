import type { BakorinClient, SignupResult } from "../index.ts";
import { type Store } from "./store.ts";
export type AuthStatus = "loading" | "signed-in" | "signed-out";
export interface AuthState<U = Record<string, unknown>> {
    status: AuthStatus;
    user: U | null;
    /** The last sign in, sign up, or reset error, for an alert. */
    error: string | null;
    /** A sign in, sign up, sign out, or reset request is running. */
    pending: boolean;
}
export interface AuthController<U = Record<string, unknown>> {
    store: Store<AuthState<U>>;
    /** Loads the signed in user from /auth/me. Signed out on 401. */
    refresh(): Promise<U | null>;
    signIn(credentials: Record<string, unknown>): Promise<U | null>;
    /** Creates the account. Never signs in: Bakorin answers check_email for every signup. */
    signUp(body: Record<string, unknown>): Promise<SignupResult | null>;
    signOut(options?: {
        all?: boolean;
    }): Promise<void>;
    forgotPassword(email: string): Promise<boolean>;
    resetPassword(token: string, password: string): Promise<boolean>;
    /** Replace the user after a profile update. */
    setUser(user: U | null): void;
}
export interface CreateAuthOptions<U> {
    /** A user the server already loaded (Astro.locals, a Next server component), so there is no loading flash. */
    initialUser?: U | null;
}
/**
 * Auth state for a client. In the browser, pair it with createBrowserClient so every
 * call goes through your site's pass through route and the session stays in httpOnly cookies.
 */
export declare function createAuth<U = Record<string, unknown>>(client: BakorinClient, options?: CreateAuthOptions<U>): AuthController<U>;
