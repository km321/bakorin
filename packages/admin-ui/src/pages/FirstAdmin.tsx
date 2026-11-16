import { useState } from "preact/hooks";
import { createFirstAdmin } from "../lib/api.ts";
import { AuthLayout } from "../components/AuthLayout.tsx";
import { Brand } from "../components/Brand.tsx";

interface Props {
  onCreated: () => void;
  /** Production: ask for the one time setup token printed to the server log. */
  setupTokenRequired?: boolean;
}

export function FirstAdmin({ onCreated, setupTokenRequired = false }: Props) {
  const [email, setEmail] = useState("");
  const [setupToken, setSetupToken] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit(event: Event) {
    event.preventDefault();
    setError(null);
    const form = event.target as HTMLFormElement;
    const data = new FormData(form);
    const identity = String(data.get("email") ?? email).trim();
    const secret = String(data.get("password") ?? password);
    const token = String(data.get("setupToken") ?? setupToken).trim();
    if (secret.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (setupTokenRequired && !token) {
      setError("Enter the setup token from the server log.");
      return;
    }
    try {
      await createFirstAdmin(identity, secret, setupTokenRequired ? token : undefined);
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
        {setupTokenRequired ? (
          <div class="field">
            <label>
              Setup token <span class="req">*</span>
            </label>
            <p class="field-hint">
              Printed in the server log when it started (look for "setup token"). Each restart prints a new one.
            </p>
            <input
              name="setupToken"
              type="text"
              value={setupToken}
              required
              autoComplete="off"
              spellcheck={false}
              onInput={(event) => setSetupToken((event.target as HTMLInputElement).value)}
            />
          </div>
        ) : null}
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
