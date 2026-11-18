import {
  createStore2,
  isRequestError2
} from "./index-dyakva2e.js";

// src/headless/auth.ts
function createAuth2(client, options = {}) {
  const known = options.initialUser !== undefined;
  const store = createStore2({
    status: known ? options.initialUser ? "signed-in" : "signed-out" : "loading",
    user: options.initialUser ?? null,
    error: null,
    pending: false
  });
  async function run(work, fallback) {
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
        const user = await client.me();
        store.set((state) => ({ ...state, status: "signed-in", user }));
        return user;
      } catch (error) {
        if (isRequestError2(error) && error.status !== 401) {
          store.set((state) => ({ ...state, error: error.message }));
        }
        store.set((state) => ({ ...state, status: "signed-out", user: null }));
        return null;
      }
    },
    signIn(credentials) {
      return run(async () => {
        const result = await client.login(credentials);
        const user = result.user;
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
    }
  };
}

export { createAuth2 };
