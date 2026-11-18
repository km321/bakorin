import type { SiteConfig } from "./site-config.ts";

export const site: SiteConfig = {
  name: "Your Membership",
  nav: [{ href: "/", label: "Plans" }],
  userNav: [
    { href: "/members", label: "Members" },
    { href: "/account", label: "Account" },
  ],
  menu: [{ href: "/account", label: "Account and billing" }],
  protect: ["/members", "/account", "/join"],
  home: "/members",
  footer: "Membership built with Bakorin. Payments run through Stripe in test mode until you switch keys.",
};
