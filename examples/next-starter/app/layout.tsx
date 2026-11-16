import type { ReactNode } from "react";
import Link from "next/link";
import { UserMenu } from "@bakorin/sdk/react";
import "@bakorin/sdk/styles.css";
import "./globals.css";
import { brandingTheme, currentUser } from "../lib/bakorin.ts";
import { Providers } from "./providers.tsx";

export const metadata = {
  title: "Bakorin",
  description: "Bakorin Next.js starter",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const [user, theme] = await Promise.all([currentUser(), brandingTheme()]);
  return (
    <html lang="en" data-theme="light">
      <head>{theme ? <style dangerouslySetInnerHTML={{ __html: theme }} /> : null}</head>
      <body>
        <Providers user={user}>
          <a className="skip" href="#main">
            Skip to content
          </a>
          <header className="site-header">
            <Link className="brand" href={user ? "/app" : "/"}>
              Bakorin
            </Link>
            <nav aria-label="Main">
              {user ? (
                <>
                  <Link href="/app">Dashboard</Link>
                  <Link href="/app/tasks">Tasks</Link>
                </>
              ) : (
                <Link href="/signup">Create account</Link>
              )}
              <UserMenu links={[{ href: "/app", label: "Dashboard" }]} afterSignOut="/" />
            </nav>
          </header>
          <main className="wrap" id="main">
            {children}
          </main>
          <footer className="site-footer">
            <span>Self-hosted backend for your site.</span>
          </footer>
        </Providers>
      </body>
    </html>
  );
}
