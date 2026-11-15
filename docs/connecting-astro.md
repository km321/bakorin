# Connecting Astro

Use `@bakorin/sdk/astro`. Tokens live in `bakorin_access` / `bakorin_refresh` httpOnly cookies.

```ts
import { createAstroClient } from "@bakorin/sdk/astro";

export function api(cookies: Astro["cookies"]) {
  return createAstroClient({
    baseUrl: import.meta.env.BAKORIN_URL ?? "http://127.0.0.1:4371",
    cookies,
  });
}
```

Protect `/app` in `src/middleware.ts`:

```ts
import { defineMiddleware } from "astro:middleware";
import { api } from "./lib/bakorin";

export const onRequest = defineMiddleware(async (context, next) => {
  if (!context.url.pathname.startsWith("/app")) return next();
  try {
    await api(context.cookies).me();
    return next();
  } catch {
    return context.redirect("/login");
  }
});
```

The starter in `examples/astro-starter` (and `create-bakorin --frontend astro`) includes signup, login, logout, forgot/reset, accept invite, and a protected `/app` list.

Set `CORS_ORIGINS` on the API to the Astro origin and `APP_URL` to that origin for email links.
