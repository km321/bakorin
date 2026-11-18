import { useState } from "preact/hooks";
import { login } from "../lib/api.ts";
import { consumeSessionNotice, sessionNoticeMessage } from "../lib/session.ts";
import { AuthLayout } from "../components/AuthLayout.tsx";
import { Brand } from "../components/Brand.tsx";

interface Props {
  onLoggedIn: () => void;
  notice?: string | null;
}

export function Login({ onLoggedIn, notice }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sessionNotice] = useState<string | null>(() => {
    if (notice) {
      return notice;
    }
    const reason = consumeSessionNotice();
    return reason ? sessionNoticeMessage(reason) : null;
  });

  async function submit(event: Event) {
    event.preventDefault();
    setError(null);
    const form = event.target as HTMLFormElement;
    const data = new FormData(form);
    const identity = String(data.get("email") ?? email);
    const secret = String(data.get("password") ?? password);
    try {
      await login("email", identity, secret);
      onLoggedIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign in. Check the email and password.");
    }
  }

  return (
    <AuthLayout>
      <form class="auth-card" onSubmit={submit}>
        <Brand sub="Admin" />
        <h1>Sign in</h1>
        <p class="muted">Use an admin account from this project's auth entity.</p>
        {sessionNotice && !error ? <div class="banner" data-session-notice>{sessionNotice}</div> : null}
        {error ? <div class="banner">{error}</div> : null}
        <div class="field">
          <label>
            Email <span class="req">*</span>
          </label>
          <input
            name="email"
            type="email"
            value={email}
            required
            autoComplete="username"
            onInput={(event) => setEmail((event.target as HTMLInputElement).value)}
          />
        </div>
        <div class="field">
          <label>
            Password <span class="req">*</span>
          </label>
          <input
            name="password"
            type="password"
            value={password}
            required
            autoComplete="current-password"
            onInput={(event) => setPassword((event.target as HTMLInputElement).value)}
          />
        </div>
        <button class="btn" type="submit">
          Continue
        </button>
      </form>
    </AuthLayout>
  );
}
