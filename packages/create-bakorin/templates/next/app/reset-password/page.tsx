import { ResetPasswordForm } from "@bakorin/sdk/react";

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return (
    <section className="card">
      <h1>Reset password</h1>
      <p className="lede">Choose a new password of at least 8 characters.</p>
      <ResetPasswordForm token={token} signInHref="/login" />
    </section>
  );
}
