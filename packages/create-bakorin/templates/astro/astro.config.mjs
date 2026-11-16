import { defineConfig } from "astro/config";
import node from "@astrojs/node";

// Astro only trusts the Host header for the domains listed here. Without this,
// a production build sees every request as "localhost" and rejects form posts
// as cross-site. Set SITE_URL at build time to your public URL.
const site = process.env.SITE_URL ? new URL(process.env.SITE_URL) : undefined;

export default defineConfig({
  output: "server",
  adapter: node({ mode: "standalone" }),
  server: { port: 4321, host: "127.0.0.1" },
  security: {
    allowedDomains: [
      { hostname: "127.0.0.1" },
      { hostname: "localhost" },
      ...(site ? [{ hostname: site.hostname, protocol: site.protocol.replace(":", "") }] : []),
    ],
  },
});
