import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export default async function HomePage() {
  if ((await cookies()).get("bakorin_access")?.value) {
    redirect("/app");
  }
  return (
    <section className="card">
      <h1>Your team&apos;s workspace</h1>
      <p className="lede">Track projects, post quick updates, and see changes from your team as they happen.</p>
      <div className="actions">
        <Link className="button" href="/login">
          Sign in
        </Link>
        <Link className="button secondary" href="/signup">
          Create an account
        </Link>
      </div>
    </section>
  );
}
