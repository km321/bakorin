/** The shape of src/lib/site.ts, which each template fills in. */
export interface NavLink {
  href: string;
  label: string;
  /** Only show the link to users with one of these roles. */
  roles?: string[];
}

export interface SiteConfig {
  /** Shown in the header and the page title. */
  name: string;
  /** Links everyone sees. */
  nav: NavLink[];
  /** Links for signed in users. */
  userNav: NavLink[];
  /** Links in the user menu. */
  menu: NavLink[];
  /** Paths that need a session (whole segments: "/app" covers "/app/settings"). */
  protect: string[];
  /** Where people land after signing in. */
  home: string;
  /** Show "Create account" links. Set false when app.yaml has signup: invite or closed. */
  signup?: boolean;
  /** Use the wide page layout (grids, tables). */
  wide?: boolean;
  footer: string;
}

/** Links the signed in user may see. */
export function visibleLinks(links: NavLink[], user: { role?: unknown } | null | undefined): NavLink[] {
  return links.filter((link) => !link.roles || (user && link.roles.includes(String(user.role))));
}
