import { RichText } from "@bakorin/sdk/react";
import { api, currentUser } from "../lib/bakorin.ts";
import { planPrice, TIER_LABELS, type Plan } from "../lib/membership.ts";

export const metadata = { title: "Plans" };
export const dynamic = "force-dynamic";

export default async function PlansPage() {
  // Plans are public in app.yaml, so this works signed out too.
  const { data: plans } = await (await api()).entity("plans").list({ filter: { active: true }, sort: "sort", limit: 12 });
  const user = await currentUser();
  return (
    <section className="section">
      <h1>Become a member</h1>
      <p>Members read the lessons. Pro members also get the masterclasses.</p>
      {plans.length === 0 ? (
        <p className="empty">No plans yet. Admins can add them in /admin on the API, or run bun seed.ts for example plans.</p>
      ) : (
        <ul className="grid">
          {plans.map((plan: Plan) => (
            <li key={plan.id} className="tile">
              <div className="tile-body">
                <h2>{plan.name}</h2>
                <p className="meta">{planPrice(plan)}</p>
                {plan.description ? <RichText html={plan.description} className="prose" /> : null}
                {user?.role === plan.tier ? (
                  <p className="notice">This is your plan.</p>
                ) : (
                  <form method="get" action={`/join/${plan.id}`}>
                    <button type="submit">Join {TIER_LABELS[plan.tier] ?? plan.tier}</button>
                  </form>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
