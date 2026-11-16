import { requireAuth } from "@bakorin/sdk/astro";
import { bakorinUrl } from "./lib/bakorin.ts";
import { site } from "./lib/site.ts";

// Pages under site.protect need a session. Expired sessions renew through the pass
// through route (the refresh cookie only goes there). Every page gets Astro.locals.user.
export const onRequest = requireAuth({ baseUrl: bakorinUrl(), protect: site.protect, loginPath: "/login" });
