import { useState } from "preact/hooks";
import { login } from "../lib/api.ts";

interface Props {
  onLoggedIn: () => void;
}

export function Login({ onLoggedIn }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

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
      setError(err instanceof Error ? err.message : "login failed");
    }
  }

  return (
    <div class="login">
      <form class="login-card" onSubmit={submit}>
        <div class="brand">
          <strong>Bakorin</strong>
          <span>Admin</span>
        </div>
        <h1>Sign in</h1>
        <p class="muted">Use an admin account from your app.yaml auth entity.</p>
        {error ? <div class="banner">{error}</div> : null}
        <div class="field">
          <label>Email</label>
          <input
            name="email"
            type="email"
            value={email}
            required
            onInput={(event) => setEmail((event.target as HTMLInputElement).value)}
          />
        </div>
        <div class="field">
          <label>Password</label>
          <input
            name="password"
            type="password"
            value={password}
            required
            onInput={(event) => setPassword((event.target as HTMLInputElement).value)}
          />
        </div>
        <button class="btn" type="submit">
          Continue
        </button>
      </form>
    </div>
  );
}
