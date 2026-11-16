"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { verifyEmailAction } from "../actions.ts";

// Confirm on submit, not on page load, so link scanners in mail apps do not use up the token.
function VerifyForm() {
  const token = useSearchParams().get("token") ?? "";
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  return (
    <section className="card">
      <h1>Verify email</h1>
      {done ? (
        <p>
          Email confirmed. <Link href="/login">Sign in</Link> to continue.
        </p>
      ) : (
        <>
          <p className="lede">Confirm this address to finish setting up your account.</p>
          {error ? (
            <div className="error" role="alert">
              {error}
            </div>
          ) : null}
          <form
            action={async (formData) => {
              const message = await verifyEmailAction(formData);
              if (message) {
                setError(message);
              } else {
                setDone(true);
              }
            }}
          >
            <input type="hidden" name="token" value={token} />
            <div className="actions">
              <button type="submit">Confirm email</button>
              <Link href="/login">Back to sign in</Link>
            </div>
          </form>
        </>
      )}
    </section>
  );
}

export default function VerifyPage() {
  return (
    <Suspense>
      <VerifyForm />
    </Suspense>
  );
}
