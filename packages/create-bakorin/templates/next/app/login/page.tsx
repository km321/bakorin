import { SignInForm } from "@bakorin/sdk/react";

export default function LoginPage() {
  return (
    <section className="card">
      <h1>Sign in</h1>
      <p className="lede">Welcome back. Use the email you signed up with.</p>
      {/* Signs in through /api/bakorin, which keeps the session in httpOnly cookies. */}
      <SignInForm redirectTo="/app" forgotPasswordHref="/forgot-password" signUpHref="/signup" />
    </section>
  );
}
