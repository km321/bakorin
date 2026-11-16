import { SignInForm } from "@bakorin/sdk/react";
import { site } from "../../lib/site.ts";

export default function LoginPage() {
  return (
    <section className="card">
      <h1>Sign in</h1>
      <p className="lede">Welcome back. Use the email you signed up with.</p>
      {/* Signs in through /api/bakorin, which keeps the session in httpOnly cookies. */}
      <SignInForm redirectTo={site.home} forgotPasswordHref="/forgot-password" signUpHref={site.signup === false ? undefined : "/signup"} />
    </section>
  );
}
