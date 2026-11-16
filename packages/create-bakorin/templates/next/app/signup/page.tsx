import { SignUpForm } from "@bakorin/sdk/react";

export default function SignupPage() {
  return (
    <section className="card">
      <h1>Create account</h1>
      <p className="lede">Use an email and a password of at least 8 characters. Check the API logs for the email when MAIL_DRIVER=log.</p>
      {/* Signup never signs you in and answers the same way for a new or a taken email. */}
      <SignUpForm signInHref="/login" />
    </section>
  );
}
