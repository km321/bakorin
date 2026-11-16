import type { SiteConfig } from "./site-config.ts";

export const site: SiteConfig = {
  name: "Your Company",
  nav: [
    { href: "/", label: "Home" },
    { href: "/about", label: "About" },
    { href: "/contact", label: "Contact" },
  ],
  userNav: [{ href: "/app/leads", label: "Leads", roles: ["admin"] }],
  menu: [{ href: "/app/leads", label: "Leads", roles: ["admin"] }],
  protect: ["/app"],
  home: "/app/leads",
  // app.yaml uses signup: invite. Invite teammates from the Bakorin admin.
  signup: false,
  footer: "Built with Bakorin.",
};
