import type { SiteConfig } from "./site-config.ts";

export const site: SiteConfig = {
  name: "Your Store",
  nav: [{ href: "/", label: "Shop" }],
  userNav: [
    { href: "/cart", label: "Cart" },
    { href: "/orders", label: "Orders" },
    { href: "/manage", label: "Manage", roles: ["admin"] },
  ],
  menu: [
    { href: "/orders", label: "Orders" },
    { href: "/manage", label: "Manage products", roles: ["admin"] },
  ],
  protect: ["/cart", "/orders", "/checkout", "/manage"],
  home: "/",
  wide: true,
  footer: "Store built with Bakorin. Payments run through Stripe Checkout in test mode until you switch keys.",
};
