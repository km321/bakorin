import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export default async function HomePage() {
  if ((await cookies()).get("bakorin_access")?.value) {
    redirect("/app");
  }
  return (
    <section className="card">
      <h1>Your data, on your host</h1>
      <p className="lede">This starter talks to a Bakorin API for signup, login, password reset, invites, and a private task list.</p>
      <div className="actions">
        <Link className="button" href="/signup">
          Create an account
        </Link>
        <Link className="button secondary" href="/login">
          Sign in
        </Link>
      </div>
    </section>
  );
}
