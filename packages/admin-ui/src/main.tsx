import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { getSetup, hasToken } from "./lib/api.ts";
import { applyTheme, readStoredThemeMode } from "./lib/theme.ts";
import { FirstAdmin } from "./pages/FirstAdmin.tsx";
import { Login } from "./pages/Login.tsx";
import { AppShell } from "./pages/AppShell.tsx";
import { AuthLayout } from "./components/AuthLayout.tsx";
import { ToastHost } from "./components/ToastHost.tsx";
import { syncSystemTheme } from "./components/ThemeToggle.tsx";
import "./styles/app.css";

type Gate = "loading" | "first-admin" | "login" | "app";

function Root() {
  const [gate, setGate] = useState<Gate>(hasToken() ? "app" : "loading");

  useEffect(() => {
    applyTheme(readStoredThemeMode());
    return syncSystemTheme();
  }, []);

  useEffect(() => {
    if (hasToken()) {
      return;
    }
    void getSetup()
      .then((setup) => setGate(setup.firstAdmin ? "first-admin" : "login"))
      .catch(() => setGate("login"));
  }, []);

  let screen;
  switch (gate) {
    case "loading":
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
      screen = <FirstAdmin onCreated={() => setGate("app")} />;
      break;
    case "login":
      screen = <Login onLoggedIn={() => setGate("app")} />;
      break;
    case "app":
      screen = <AppShell onLogout={() => setGate("login")} />;
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
