"use client";

import { useState } from "react";
import Link from "next/link";
import { signupAction } from "../actions.ts";

export default function SignupPage() {
  const [error, setError] = useState("");
  const [sent, setSent] = useState("");
  return (
    <section className="card">
      <h1>Create account</h1>
      <p className="lede">Use an email and a password of at least 8 characters.</p>
      {error ? (
        <div className="error" role="alert">
          {error}
        </div>
      ) : null}
      {sent ? (
        <>
          <div className="banner" role="status">
            {sent}
          </div>
          <p>
            Check the API logs when MAIL_DRIVER=log. <Link href="/login">Go to sign in</Link>
          </p>
        </>
      ) : (
        <form
          action={async (formData) => {
            const result = await signupAction(formData);
            if (result.ok) {
              setError("");
              setSent(result.message);
            } else {
              setError(result.message);
            }
          }}
        >
          <label>
            Name
            <input type="text" name="name" autoComplete="name" required />
          </label>
          <label>
            Email
            <input type="email" name="email" autoComplete="email" required />
          </label>
          <label>
            Password
            <input type="password" name="password" autoComplete="new-password" minLength={8} required />
          </label>
          <div className="actions">
            <button type="submit">Create account</button>
            <Link href="/login">Already have an account?</Link>
          </div>
        </form>
      )}
    </section>
  );
}
