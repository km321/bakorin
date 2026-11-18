import Link from "next/link";
import { notFound } from "next/navigation";
import { api } from "../../../lib/bakorin.ts";
import { planPrice } from "../../../lib/membership.ts";
import { joinPlan } from "../../membership-actions.ts";

export const metadata = { title: "Join" };

export default async function JoinPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  // middleware.ts protects /join. hooks.ts opens Stripe Checkout for the plan.
  const { id } = await params;
  const { error } = await searchParams;
  const plan = await (await api()).entity("plans").get(id).catch(() => null);
  if (!plan) notFound();
  return (
    <section className="card">
      <h1>Join {plan.name}</h1>
      <p className="meta">{planPrice(plan)}</p>
      {error ? (
        <p className="notice" role="alert">
          {error}
        </p>
      ) : null}
      <p>You will pay on Stripe&apos;s secure checkout page, then come back to your account.</p>
      <form action={joinPlan}>
        <input type="hidden" name="planId" value={plan.id} />
        <button type="submit">Continue to Stripe</button>
      </form>
      <p>
        <Link href="/">Back to plans</Link>
      </p>
    </section>
  );
}
