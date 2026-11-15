import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { getSetup, hasToken } from "./lib/api.ts";
import { FirstAdmin } from "./pages/FirstAdmin.tsx";
import { Login } from "./pages/Login.tsx";
import { AppShell } from "./pages/AppShell.tsx";
import "./styles/app.css";

type Gate = "loading" | "first-admin" | "login" | "app";

function Root() {
  const [gate, setGate] = useState<Gate>(hasToken() ? "app" : "loading");

  useEffect(() => {
    if (hasToken()) {
      return;
    }
    void getSetup()
      .then((setup) => setGate(setup.firstAdmin ? "first-admin" : "login"))
      .catch(() => setGate("login"));
  }, []);

  switch (gate) {
    case "loading":
      return (
        <div class="login">
          <div class="login-card">
            <div class="brand">
              <strong>Bakorin</strong>
              <span>Admin</span>
            </div>
            <p class="muted">Loading...</p>
          </div>
        </div>
      );
    case "first-admin":
      return <FirstAdmin onCreated={() => setGate("app")} />;
    case "login":
      return <Login onLoggedIn={() => setGate("app")} />;
    case "app":
      return <AppShell onLogout={() => setGate("login")} />;
    default: {
      const _never: never = gate;
      return _never;
    }
  }
}

render(<Root />, document.getElementById("app")!);
