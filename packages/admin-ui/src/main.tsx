import { render } from "preact";
import { useCallback, useEffect, useState } from "preact/hooks";
import { authedFetch, getSetup, hasToken, signOut } from "./lib/api.ts";
import { checkAdminAccess, screenForAccess } from "./lib/access.ts";
import { applyTheme, readStoredThemeMode } from "./lib/theme.ts";
import { FirstAdmin } from "./pages/FirstAdmin.tsx";
import { Login } from "./pages/Login.tsx";
import { AppShell } from "./pages/AppShell.tsx";
import { AccessError, AdminsOnly } from "./pages/AdminsOnly.tsx";
import { AuthLayout } from "./components/AuthLayout.tsx";
import { ToastHost } from "./components/ToastHost.tsx";
import { syncSystemTheme } from "./components/ThemeToggle.tsx";
import "./styles/app.css";

type Gate = "loading" | "checking" | "first-admin" | "login" | "app" | "admins-only" | "access-error";

function Root() {
  const [gate, setGate] = useState<Gate>(hasToken() ? "checking" : "loading");
  const [identity, setIdentity] = useState<string | null>(null);

  useEffect(() => {
    applyTheme(readStoredThemeMode());
    return syncSystemTheme();
  }, []);

  const toLoginOrSetup = useCallback(() => {
    void getSetup()
      .then((setup) => setGate(setup.firstAdmin ? "first-admin" : "login"))
      .catch(() => setGate("login"));
  }, []);

  useEffect(() => {
    if (gate === "loading") {
      toLoginOrSetup();
      return;
    }
    if (gate !== "checking") {
      return;
    }
    let cancelled = false;
    void checkAdminAccess(authedFetch).then((result) => {
      if (cancelled) {
        return;
      }
      setIdentity(result.identity);
      const next = screenForAccess(result.access);
      if (next === "login") {
        void signOut().then(toLoginOrSetup);
        return;
      }
      setGate(next);
    });
    return () => {
      cancelled = true;
    };
  }, [gate, toLoginOrSetup]);

  const handleSignOut = useCallback(() => {
    setIdentity(null);
    void signOut().then(() => setGate("login"));
  }, []);

  let screen;
  switch (gate) {
    case "loading":
    case "checking":
      screen = (
        <AuthLayout>
          <div class="auth-card">
            <div class="brand">
              <strong>Bakorin</strong>
              <span>Admin</span>
            </div>
            <p class="muted">Loading...</p>
          </div>
        </AuthLayout>
      );
      break;
    case "first-admin":
      screen = <FirstAdmin onCreated={() => setGate("checking")} />;
      break;
    case "login":
      screen = <Login onLoggedIn={() => setGate("checking")} />;
      break;
    case "admins-only":
      screen = <AdminsOnly identity={identity} onSignOut={handleSignOut} />;
      break;
    case "access-error":
      screen = <AccessError onRetry={() => setGate("checking")} onSignOut={handleSignOut} />;
      break;
    case "app":
      screen = <AppShell onLogout={() => setGate("login")} onForbidden={() => setGate("checking")} />;
      break;
    default: {
      const _never: never = gate;
      screen = _never;
    }
  }

  return (
    <>
      {screen}
      <ToastHost />
    </>
  );
}

render(<Root />, document.getElementById("app")!);
