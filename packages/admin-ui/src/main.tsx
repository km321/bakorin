import { render } from "preact";
import { useCallback, useEffect, useState } from "preact/hooks";
import { authedFetch, getSetup, hasToken, logout, signOut } from "./lib/api.ts";
import { SESSION_ENDED_EVENT, consumeSessionNotice, sessionNoticeMessage, subscribeSessionMessages, writeSessionNotice } from "./lib/session.ts";
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
import { Brand } from "./components/Brand.tsx";

type Gate = "loading" | "checking" | "first-admin" | "login" | "app" | "admins-only" | "access-error";

function Root() {
  const [gate, setGate] = useState<Gate>(hasToken() ? "checking" : "loading");
  const [identity, setIdentity] = useState<string | null>(null);
  const [setupTokenRequired, setSetupTokenRequired] = useState(false);
  const [loginNotice, setLoginNotice] = useState<string | null>(null);

  useEffect(() => {
    applyTheme(readStoredThemeMode());
    return syncSystemTheme();
  }, []);

  useEffect(() => {
    function goToLogin(reason?: string) {
      if (reason === "expired" || reason === "idle") {
        writeSessionNotice(reason);
        setLoginNotice(sessionNoticeMessage(reason));
      }
      setIdentity(null);
      setGate("login");
    }
    function onEnded(event: Event) {
      const reason = (event as CustomEvent<{ reason?: string }>).detail?.reason;
      goToLogin(reason);
    }
    window.addEventListener(SESSION_ENDED_EVENT, onEnded);
    const unsubscribe = subscribeSessionMessages((message) => {
      if (message.type === "signout") {
        logout();
        goToLogin(message.reason);
      }
    });
    return () => {
      window.removeEventListener(SESSION_ENDED_EVENT, onEnded);
      unsubscribe();
    };
  }, []);

  const toLoginOrSetup = useCallback(() => {
    void getSetup()
      .then((setup) => {
        setSetupTokenRequired(setup.setupTokenRequired === true);
        setGate(setup.firstAdmin ? "first-admin" : "login");
      })
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
            <Brand sub="Admin" />
            <p class="muted">Loading...</p>
          </div>
        </AuthLayout>
      );
      break;
    case "first-admin":
      screen = <FirstAdmin setupTokenRequired={setupTokenRequired} onCreated={() => setGate("checking")} />;
      break;
    case "login":
      screen = (
        <Login
          onLoggedIn={() => {
            setLoginNotice(null);
            consumeSessionNotice();
            setGate("checking");
          }}
          notice={loginNotice}
        />
      );
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
