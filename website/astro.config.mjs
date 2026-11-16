// @ts-check
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

// Private preview build. Fully static output for Cloudflare Pages.
export default defineConfig({
  site: "https://bakorin-preview.pages.dev",
  output: "static",
  trailingSlash: "ignore",
  integrations: [
    starlight({
      title: "Bakorin",
      description: "A self-hosted backend you can spin up per client. One app.yaml, one binary, one database.",
      logo: {
        light: "./src/assets/mark-light.svg",
        dark: "./src/assets/mark-dark.svg",
        alt: "Bakorin",
      },
      favicon: "/favicon.svg",
      customCss: [
        "@fontsource-variable/geist",
        "@fontsource-variable/geist-mono",
        "./src/styles/starlight.css",
      ],
      head: [
        { tag: "meta", attrs: { name: "robots", content: "noindex, nofollow" } },
      ],
      components: {
        SocialIcons: "./src/components/DocsHeaderLinks.astro",
        Banner: "./src/components/DocsBanner.astro",
      },
      lastUpdated: false,
      pagination: true,
      expressiveCode: {
        themes: ["github-dark-default", "github-light-default"],
        styleOverrides: { borderRadius: "10px", codeFontFamily: "'Geist Mono Variable', ui-monospace, monospace" },
      },
      sidebar: [
        {
          label: "Start here",
          items: [
            { label: "Introduction", slug: "docs" },
            { label: "Getting started", slug: "docs/getting-started" },
            { label: "Templates", slug: "docs/templates" },
            { label: "Project structure", slug: "docs/project-structure" },
          ],
        },
        {
          label: "Build your schema",
          items: [
            { label: "app.yaml reference", slug: "docs/app-yaml" },
            { label: "app.yaml builder", link: "/builder/" },
            { label: "Data and relations", slug: "docs/data" },
            { label: "Permissions", slug: "docs/permissions" },
            { label: "Hooks and custom routes", slug: "docs/hooks" },
          ],
        },
        {
          label: "Features",
          items: [
            { label: "Auth", slug: "docs/auth" },
            { label: "Email", slug: "docs/email" },
            { label: "Files", slug: "docs/files" },
            { label: "Branding", slug: "docs/branding" },
            { label: "Webhooks", slug: "docs/webhooks" },
            { label: "Realtime", slug: "docs/realtime" },
            { label: "Admin UI", slug: "docs/admin-ui" },
            { label: "Schema visualizer", slug: "docs/schema" },
          ],
        },
        {
          label: "Front ends",
          items: [
            { label: "SDK", slug: "docs/sdk" },
            { label: "Astro", slug: "docs/astro" },
            { label: "Next.js", slug: "docs/nextjs" },
            { label: "Components", slug: "docs/components" },
            { label: "React components", slug: "docs/components-react" },
            { label: "Astro components", slug: "docs/components-astro" },
            { label: "Headless helpers", slug: "docs/headless" },
            { label: "Styling components", slug: "docs/components-styling" },
            { label: "MCP for AI tools", slug: "docs/mcp" },
          ],
        },
        {
          label: "Operate",
          items: [
            { label: "Deploy on Railway", slug: "docs/deploy-railway" },
            { label: "Deploy with Docker", slug: "docs/deploy-docker" },
            { label: "Backup and restore", slug: "docs/backups" },
            { label: "Schema changes", slug: "docs/migrations" },
            { label: "Monitoring", slug: "docs/monitoring" },
            { label: "Configuration", slug: "docs/configuration" },
            { label: "CLI", slug: "docs/cli" },
            { label: "Security", slug: "docs/security" },
            { label: "Scaling", slug: "docs/scaling" },
          ],
        },
        {
          label: "Project",
          items: [{ label: "Status and roadmap", slug: "docs/roadmap" }],
        },
      ],
    }),
  ],
});
