// Pass through for browser code: /api/bakorin/* goes to Bakorin with the
// httpOnly session cookies. It refreshes expired tokens, blocks cross-site
// writes, and streams realtime events. See src/pages/app/index.astro.
import { createAstroProxy } from "@bakorin/sdk/astro";
import { bakorinUrl } from "../../../lib/bakorin.ts";

export const prerender = false;

export const ALL = createAstroProxy({ baseUrl: bakorinUrl() });
