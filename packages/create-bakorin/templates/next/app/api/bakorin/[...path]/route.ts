// Pass through for client components: /api/bakorin/* goes to Bakorin with the
// httpOnly session cookies. It refreshes expired tokens, blocks cross-site
// writes, and streams realtime events. The React components in @bakorin/sdk/react call it.
import { createNextProxy } from "@bakorin/sdk/next";
import { bakorinUrl } from "../../../../lib/bakorin.ts";

export const dynamic = "force-dynamic";

export const { GET, POST, PATCH, PUT, DELETE } = createNextProxy({ baseUrl: bakorinUrl() });
