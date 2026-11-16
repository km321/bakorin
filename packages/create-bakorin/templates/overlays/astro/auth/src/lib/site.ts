import type { SiteConfig } from "./site-config.ts";

export const site: SiteConfig = {
  name: "Bakorin",
  nav: [],
  userNav: [{ href: "/app", label: "Account" }],
  menu: [{ href: "/app", label: "Account" }],
  protect: ["/app"],
  home: "/app",
  footer: "Self-hosted backend for your site.",
};
