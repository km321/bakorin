import { render } from "preact";
import { useState } from "preact/hooks";
import { hasToken } from "./lib/api.ts";
import { Login } from "./pages/Login.tsx";
import { AppShell } from "./pages/AppShell.tsx";
import "./styles/app.css";

function Root() {
  const [authed, setAuthed] = useState(hasToken());
  if (!authed) {
    return <Login onLoggedIn={() => setAuthed(true)} />;
  }
  return <AppShell onLogout={() => setAuthed(false)} />;
}

render(<Root />, document.getElementById("app")!);
