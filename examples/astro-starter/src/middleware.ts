import { defineMiddleware } from "astro:middleware";
import { api } from "./lib/bakorin.ts";

export const onRequest = defineMiddleware(async (context, next) => {
  if (!context.url.pathname.startsWith("/app")) {
    return next();
  }
  try {
    await api(context).me();
    return next();
  } catch {
    // The refresh cookie only goes to the pass through route, so renew the session there.
    const back = encodeURIComponent(context.url.pathname + context.url.search);
    return context.redirect(`/api/bakorin/-/refresh?next=${back}&fail=/login`);
  }
});
