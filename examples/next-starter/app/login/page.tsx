"use client";

import { useState } from "react";
import Link from "next/link";
import { loginAction } from "../actions.ts";

export default function LoginPage() {
  const [error, setError] = useState("");
  return (
    <section className="card">
      <h1>Sign in</h1>
      <p className="lede">Welcome back. Use the email you signed up with.</p>
      {error ? (
        <div className="error" role="alert">
          {error}
        </div>
      ) : null}
      <form
        action={async (formData) => {
          const message = await loginAction(formData);
          if (message) {
            setError(message);
          }
        }}
      >
        <label>
          Email
          <input type="email" name="email" autoComplete="email" required />
        </label>
        <label>
          Password
          <input type="password" name="password" autoComplete="current-password" minLength={8} required />
        </label>
        <div className="actions">
          <button type="submit">Sign in</button>
          <Link href="/forgot-password">Forgot password?</Link>
        </div>
      </form>
    </section>
  );
}
