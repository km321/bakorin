"use client";

import { useState } from "react";
import Link from "next/link";
import { forgotAction } from "../actions.ts";

export default function ForgotPage() {
  const [sent, setSent] = useState(false);
  return (
    <section className="card">
      <h1>Forgot password</h1>
      <p className="lede">If that email exists, Bakorin sends a reset link. Check the API logs when MAIL_DRIVER=log.</p>
      {sent ? (
        <div className="banner" role="status">
          If an account exists for that address, a reset email is on the way.
        </div>
      ) : (
        <form
          action={async (formData) => {
            await forgotAction(formData);
            setSent(true);
          }}
        >
          <label>
            Email
            <input type="email" name="email" autoComplete="email" required />
          </label>
          <div className="actions">
            <button type="submit">Send reset link</button>
            <Link href="/login">Back to sign in</Link>
          </div>
        </form>
      )}
    </section>
  );
}
