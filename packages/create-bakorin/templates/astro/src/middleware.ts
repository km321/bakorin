import { defineMiddleware } from "astro:middleware";
import { api } from "./lib/bakorin.ts";

export const onRequest = defineMiddleware(async (context, next) => {
  if (!context.url.pathname.startsWith("/app")) {
    return next();
  }
  try {
    await api(context.cookies).me();
    return next();
  } catch {
    return context.redirect("/login");
  }
});
