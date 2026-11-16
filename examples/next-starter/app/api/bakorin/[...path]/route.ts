// Pass through for client components: /api/bakorin/* goes to Bakorin with the
// httpOnly session cookies. It refreshes expired tokens, blocks cross-site
// writes, and streams realtime events. See app/app/live-tasks.tsx.
import { createNextProxy } from "@bakorin/sdk/next";
import { bakorinUrl } from "../../../../lib/bakorin.ts";

export const dynamic = "force-dynamic";

export const { GET, POST, PATCH, PUT, DELETE } = createNextProxy({ baseUrl: bakorinUrl() });
