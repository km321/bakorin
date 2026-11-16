import Link from "next/link";
import { currentUser } from "../lib/bakorin.ts";

export default async function HomePage() {
  const user = await currentUser();
  return (
    <section className="card">
      <h1>Accounts, ready to build on</h1>
      <p className="lede">
        This starter has sign up, sign in, password reset, invites, and a protected account page. Add entities to app.yaml and pages here as you go.
      </p>
      <div className="actions">
        {user ? (
          <Link className="button" href="/app">
            Go to your account
          </Link>
        ) : (
          <>
            <Link className="button" href="/signup">
              Create an account
            </Link>
            <Link className="button secondary" href="/login">
              Sign in
            </Link>
          </>
        )}
      </div>
    </section>
  );
}
