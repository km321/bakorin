"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { NavLink } from "../lib/site-config.ts";

/** Header links, with aria-current on the page you are on. */
export function NavLinks({ links }: { links: NavLink[] }) {
  const path = usePathname();
  const matches = (href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`));
  // Only the closest match is current, so /app/tasks marks Tasks and not Dashboard (/app) too.
  const active = links.map((link) => link.href).filter(matches).sort((a, b) => b.length - a.length)[0];
  const current = (href: string) => href === active;
  return (
    <>
      {links.map((link) => (
        <Link key={link.href} href={link.href} aria-current={current(link.href) ? "page" : undefined}>
          {link.label}
        </Link>
      ))}
    </>
  );
}
