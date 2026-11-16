"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { NavLink } from "../lib/site-config.ts";

/** Header links, with aria-current on the page you are on. */
export function NavLinks({ links }: { links: NavLink[] }) {
  const path = usePathname();
  const current = (href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`));
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
