import type { BakorinClient, SignupResult } from "../index.ts";
import { isRequestError } from "./form.ts";
import { createStore, type Store } from "./store.ts";

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
  signOut(options?: { all?: boolean }): Promise<void>;
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
export function createAuth<U = Record<string, unknown>>(
  client: BakorinClient,
  options: CreateAuthOptions<U> = {},
): AuthController<U> {
  const known = options.initialUser !== undefined;
  const store = createStore<AuthState<U>>({
    status: known ? (options.initialUser ? "signed-in" : "signed-out") : "loading",
    user: options.initialUser ?? null,
    error: null,
    pending: false,
  });

  async function run<T>(work: () => Promise<T>, fallback: T): Promise<T> {
    store.set((state) => ({ ...state, pending: true, error: null }));
    try {
      const result = await work();
      store.set((state) => ({ ...state, pending: false }));
      return result;
    } catch (error) {
      store.set((state) => ({ ...state, pending: false, error: error instanceof Error ? error.message : String(error) }));
      return fallback;
    }
  }

  return {
    store,
    async refresh() {
      try {
        const user = (await client.me()) as U;
        store.set((state) => ({ ...state, status: "signed-in", user }));
        return user;
      } catch (error) {
        if (isRequestError(error) && error.status !== 401) {
          store.set((state) => ({ ...state, error: error.message }));
        }
        store.set((state) => ({ ...state, status: "signed-out", user: null }));
        return null;
      }
    },
    signIn(credentials) {
      return run(async () => {
        const result = await client.login(credentials);
        const user = result.user as U;
        store.set((state) => ({ ...state, status: "signed-in", user }));
        return user;
      }, null);
    },
    signUp(body) {
      return run(() => client.signup(body), null);
    },
    async signOut(signOutOptions = {}) {
      await run(async () => {
        await client.logout(undefined, signOutOptions);
      }, undefined);
      store.set((state) => ({ ...state, status: "signed-out", user: null }));
    },
    forgotPassword(email) {
      return run(async () => (await client.forgotPassword({ email })).ok, false);
    },
    resetPassword(token, password) {
      return run(async () => (await client.resetPassword({ token, password })).ok, false);
    },
    setUser(user) {
      store.set((state) => ({ ...state, user, status: user ? "signed-in" : "signed-out" }));
    },
  };
}
