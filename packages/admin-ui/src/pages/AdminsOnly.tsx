/** @jsxImportSource preact */
import { AuthLayout } from "../components/AuthLayout.tsx";

interface Props {
  identity: string | null;
  onSignOut: () => void;
}

export function AdminsOnly({ identity, onSignOut }: Props) {
  return (
    <AuthLayout>
      <section class="auth-card" role="alert" aria-labelledby="admins-only-title">
        <div class="brand">
          <strong>Bakorin</strong>
          <span>Admin</span>
        </div>
        <h1 id="admins-only-title">Admins only</h1>
        <p>
          {identity ? `You are signed in as ${identity}, but this account is not an admin.` : "This account is not an admin."} The admin
          dashboard is only available to admins of this project.
        </p>
        <p class="muted">Ask an admin to change your role, or sign out and use an admin account.</p>
        <button class="btn" type="button" onClick={onSignOut}>
          Sign out
        </button>
      </section>
    </AuthLayout>
  );
}

interface ErrorProps {
  onRetry: () => void;
  onSignOut: () => void;
}

export function AccessError({ onRetry, onSignOut }: ErrorProps) {
  return (
    <AuthLayout>
      <section class="auth-card" role="alert" aria-labelledby="access-error-title">
        <div class="brand">
          <strong>Bakorin</strong>
          <span>Admin</span>
        </div>
        <h1 id="access-error-title">Could not check your access</h1>
        <p class="muted">The server did not answer as expected. Try again, or sign out.</p>
        <div class="row-actions">
          <button class="btn" type="button" onClick={onRetry}>
            Try again
          </button>
          <button class="btn secondary" type="button" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </section>
    </AuthLayout>
  );
}
