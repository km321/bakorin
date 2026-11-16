import type { ReactNode } from "react";
import Link from "next/link";
import { UserMenu } from "@bakorin/sdk/react";
import "@bakorin/sdk/styles.css";
import "./globals.css";
import { brandingTheme, currentUser } from "../lib/bakorin.ts";
import { site } from "../lib/site.ts";
import { visibleLinks } from "../lib/site-config.ts";
import { NavLinks } from "./nav.tsx";
import { Providers } from "./providers.tsx";

export const metadata = {
  title: { default: site.name, template: `%s · ${site.name}` },
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const [user, theme] = await Promise.all([currentUser(), brandingTheme()]);
  const wide = site.wide ? " wide" : "";
  const links = [...site.nav, ...(user ? visibleLinks(site.userNav, user) : [])];
  return (
    <html lang="en" data-theme="light">
      <head>{theme ? <style dangerouslySetInnerHTML={{ __html: theme }} /> : null}</head>
      <body>
        <Providers user={user}>
          <a className="skip" href="#main">
            Skip to content
          </a>
          <header className={`site-header${wide}`}>
            <Link className="brand" href="/">
              {site.name}
            </Link>
            <nav aria-label="Main">
              <NavLinks links={links} />
              {!user && site.signup !== false && <Link href="/signup">Create account</Link>}
              <UserMenu links={visibleLinks(site.menu, user)} afterSignOut="/" />
            </nav>
          </header>
          <main className={`wrap${wide}`} id="main">
            {children}
          </main>
          <footer className={`site-footer${wide}`}>
            <span>{site.footer}</span>
          </footer>
        </Providers>
      </body>
    </html>
  );
}
