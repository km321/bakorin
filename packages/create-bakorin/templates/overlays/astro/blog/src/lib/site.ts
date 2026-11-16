import type { SiteConfig } from "./site-config.ts";

export const site: SiteConfig = {
  name: "Your Blog",
  nav: [{ href: "/", label: "Posts" }],
  userNav: [{ href: "/write", label: "Write", roles: ["admin"] }],
  menu: [{ href: "/write", label: "Write", roles: ["admin"] }],
  // Writing pages need a session; the pages also check for the admin role.
  protect: ["/write"],
  home: "/",
  // app.yaml uses signup: invite. Readers do not need accounts; invite writers from the Bakorin admin.
  signup: false,
  footer: "Published with Bakorin.",
};
