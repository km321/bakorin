"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { acceptInviteAction } from "../actions.ts";

function InviteForm() {
  const token = useSearchParams().get("token") ?? "";
  const [error, setError] = useState("");
  return (
    <section className="card">
      <h1>Accept invite</h1>
      <p className="lede">Set your name and password to join this Bakorin app.</p>
      {error ? (
        <div className="error" role="alert">
          {error}
        </div>
      ) : null}
      <form
        action={async (formData) => {
          const message = await acceptInviteAction(formData);
          if (message) {
            setError(message);
          }
        }}
      >
        <input type="hidden" name="token" value={token} />
        <label>
          Name
          <input type="text" name="name" autoComplete="name" />
        </label>
        <label>
          Password
          <input type="password" name="password" autoComplete="new-password" minLength={8} required />
        </label>
        <div className="actions">
          <button type="submit">Join</button>
        </div>
      </form>
    </section>
  );
}

export default function AcceptInvitePage() {
  return (
    <Suspense>
      <InviteForm />
    </Suspense>
  );
}
