import Link from "next/link";
import { redirect } from "next/navigation";
import { refreshUrl } from "@bakorin/sdk/next";
import { currentUser } from "../../lib/bakorin.ts";
import { isMember, TIER_LABELS } from "../../lib/membership.ts";
import { openBilling } from "../membership-actions.ts";

export const metadata = { title: "Account" };
export const dynamic = "force-dynamic";

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ joined?: string; error?: string }> }) {
  // middleware.ts protects /account. Only verified Stripe webhooks change the plan (hooks.ts).
  // The role rides in the session token, so after checkout this page renews the session once.
  const { joined, error } = await searchParams;
  if (joined === "1") redirect(refreshUrl("/account?joined=2"));
  const me = await currentUser();
  if (!me) redirect(refreshUrl("/account"));
  const member = isMember(me.role);
  return (
    <section className="card">
      <h1>Your membership</h1>
      {joined === "2" && !member ? (
        <p className="notice" role="status">
          Thanks. We are confirming your payment with Stripe. <a href={refreshUrl("/account?joined=2")}>Refresh</a> in a moment.
        </p>
      ) : joined === "2" ? (
        <p className="notice" role="status">
          Welcome. Your membership is active. <Link href="/members">Go to the members area</Link>.
        </p>
      ) : null}
      {error ? (
        <p className="notice" role="alert">
          {error}
        </p>
      ) : null}
      <p>
        <strong>Plan:</strong> {TIER_LABELS[String(me.role)] ?? me.role}
      </p>
      <p>
        <strong>Status:</strong> {me.subscriptionStatus ?? "No subscription"}
      </p>
      {me.currentPeriodEnd ? (
        <p>
          <strong>Current period ends:</strong> {new Date(me.currentPeriodEnd).toLocaleDateString("en-US", { dateStyle: "medium" })}
        </p>
      ) : null}
      {me.subscriptionStatus ? (
        <form action={openBilling}>
          <button type="submit">Manage billing</button>
        </form>
      ) : (
        <p>
          <Link className="button" href="/">
            Pick a plan
          </Link>
        </p>
      )}
    </section>
  );
}
