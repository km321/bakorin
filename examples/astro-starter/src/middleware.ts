import { requireAuth } from "@bakorin/sdk/astro";
import { bakorinUrl } from "./lib/bakorin.ts";

// Pages under /app need a session. Expired sessions renew through the pass through
// route (the refresh cookie only goes there). Every page gets Astro.locals.user.
export const onRequest = requireAuth({ baseUrl: bakorinUrl(), protect: ["/app"], loginPath: "/login" });
