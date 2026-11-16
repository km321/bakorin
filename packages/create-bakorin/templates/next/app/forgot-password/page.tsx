import { ForgotPasswordForm } from "@bakorin/sdk/react";

export default function ForgotPasswordPage() {
  return (
    <section className="card">
      <h1>Forgot password</h1>
      <p className="lede">If that email exists, Bakorin sends a reset link. Check the API logs when MAIL_DRIVER=log.</p>
      <ForgotPasswordForm signInHref="/login" />
    </section>
  );
}
