import type { SiteConfig } from "./site-config.ts";

export const site: SiteConfig = {
  name: "Team Workspace",
  nav: [],
  userNav: [
    { href: "/app", label: "Dashboard" },
    { href: "/app/projects", label: "Projects" },
    { href: "/app/team", label: "Team", roles: ["admin"] },
  ],
  menu: [{ href: "/app", label: "Dashboard" }],
  protect: ["/app"],
  home: "/app",
  wide: true,
  footer: "Internal tool built with Bakorin.",
};
