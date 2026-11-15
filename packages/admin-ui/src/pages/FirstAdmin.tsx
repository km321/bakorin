import { useState } from "preact/hooks";
import { createFirstAdmin } from "../lib/api.ts";
import { AuthLayout } from "../components/AuthLayout.tsx";
import { Brand } from "../components/Brand.tsx";

interface Props {
  onCreated: () => void;
}

export function FirstAdmin({ onCreated }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit(event: Event) {
    event.preventDefault();
    setError(null);
    const form = event.target as HTMLFormElement;
    const data = new FormData(form);
    const identity = String(data.get("email") ?? email).trim();
    const secret = String(data.get("password") ?? password);
    if (secret.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    try {
      await createFirstAdmin(identity, secret);
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "could not create admin");
    }
  }

  return (
    <AuthLayout>
      <form class="auth-card" onSubmit={submit}>
        <Brand sub="Admin" />
        <h1>Create your first admin</h1>
        <p class="muted">No admin exists yet. This form is available only until the first admin is created.</p>
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
          <p class="field-hint">At least 8 characters.</p>
          <input
            name="password"
            type="password"
            value={password}
            required
            minLength={8}
            autoComplete="new-password"
            onInput={(event) => setPassword((event.target as HTMLInputElement).value)}
          />
        </div>
        <button class="btn" type="submit">
          Create admin
        </button>
      </form>
    </AuthLayout>
  );
}
