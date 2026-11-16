import type { NextConfig } from "next";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // This folder is its own app, even inside a Bakorin checkout.
  outputFileTracingRoot: dirname(fileURLToPath(import.meta.url)),
  // Put page titles from generateMetadata in <head> for every visitor instead of
  // streaming them in later, so screen readers and link previews get them at once.
  htmlLimitedBots: /.*/,
};

export default nextConfig;
