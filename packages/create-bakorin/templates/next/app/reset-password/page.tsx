"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { resetAction } from "../actions.ts";
import { Suspense } from "react";

function ResetForm() {
  const token = useSearchParams().get("token") ?? "";
  const [error, setError] = useState("");
  return (
    <section className="card">
      <h1>Reset password</h1>
      <p className="lede">Choose a new password of at least 8 characters.</p>
      {error ? (
        <div className="error" role="alert">
          {error}
        </div>
      ) : null}
      <form
        action={async (formData) => {
          const message = await resetAction(formData);
          if (message) {
            setError(message);
          }
        }}
      >
        <input type="hidden" name="token" value={token} />
        <label>
          New password
          <input type="password" name="password" autoComplete="new-password" minLength={8} required />
        </label>
        <div className="actions">
          <button type="submit">Update password</button>
        </div>
      </form>
    </section>
  );
}

export default function ResetPage() {
  return (
    <Suspense>
      <ResetForm />
    </Suspense>
  );
}
