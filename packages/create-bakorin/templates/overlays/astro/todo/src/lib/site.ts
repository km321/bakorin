import type { SiteConfig } from "./site-config.ts";

export const site: SiteConfig = {
  name: "Bakorin",
  nav: [],
  userNav: [
    { href: "/app", label: "Dashboard" },
    { href: "/app/tasks", label: "Tasks" },
  ],
  menu: [{ href: "/app", label: "Dashboard" }],
  protect: ["/app"],
  home: "/app",
  footer: "Self-hosted backend for your site.",
};
