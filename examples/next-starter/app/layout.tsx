import type { ReactNode } from "react";
import { cookies } from "next/headers";
import Link from "next/link";
import "./globals.css";
import { bakorinUrl } from "../lib/bakorin.ts";

export const metadata = {
  title: "Bakorin",
  description: "Bakorin Next.js starter",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const token = (await cookies()).get("bakorin_access")?.value;
  let signedIn = false;
  if (token) {
    const me = await fetch(new URL("/api/v1/auth/me", bakorinUrl()), {
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    signedIn = me.ok;
  }
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <Link className="brand" href={signedIn ? "/app" : "/"}>
            Bakorin
          </Link>
          <nav aria-label="Main">
            {signedIn ? (
              <>
                <Link href="/app">App</Link>
                <a href="/api/bakorin/-/logout?next=/">Sign out</a>
              </>
            ) : (
              <>
                <Link href="/login">Sign in</Link>
                <Link href="/signup">Create account</Link>
              </>
            )}
          </nav>
        </header>
        <main className="wrap">{children}</main>
        <footer className="site-footer">
          <span>Self-hosted backend for your site.</span>
        </footer>
      </body>
    </html>
  );
}
