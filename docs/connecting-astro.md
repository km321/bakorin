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

The starter in `examples/astro-starter` (and `create-bakorin --frontend astro`) includes signup (a "check your email" message, no auto sign in), verify email, login, logout, forgot/reset, accept invite, and a protected `/app` list.

Set `CORS_ORIGINS` on the API to the Astro origin and `APP_URL` to that origin for email links.

## Browser calls and live updates

Server rendered pages cover most of an app. When browser code needs to call Bakorin, for example a live list or a toggle without a page reload, add the pass through route. Browser code calls `/api/bakorin/...` on your own site, and the route forwards to Bakorin with the httpOnly session cookies, so tokens never reach JavaScript.

```ts title="src/pages/api/bakorin/[...path].ts"
import { createAstroProxy } from "@bakorin/sdk/astro";

export const prerender = false;
export const ALL = createAstroProxy({ baseUrl: import.meta.env.BAKORIN_URL ?? "http://127.0.0.1:4371" });
```

```ts title="In a client script"
import { createBrowserClient } from "@bakorin/sdk/browser";

const api = createBrowserClient(); // calls /api/bakorin
await api.entity("tasks").update(id, { done: true });
const stop = api.subscribe("tasks", (change) => render(change));
```

What the route does:

- Refreshes an expired access token once and retries, and rotates the cookies.
- Turns login and refresh responses into cookies and removes the tokens from the body. Logout clears them.
- Refuses writes from other sites: a POST, PATCH, PUT, or DELETE needs an `Origin` that matches your site (or `allowedOrigins`), otherwise it answers 403.
- Streams [realtime](realtime.md) events without buffering.
- Rejects paths with `..` and blocks `/auth/refresh`, which only the route itself calls.

Options: `prefix` (default `/api/bakorin`), `allowedOrigins`, `cookies` (names, `secure`, refresh lifetime), and `getClientIp` to forward the visitor IP when Bakorin trusts your proxy.

The starter's `/app` page uses this route to keep the task list live and toggle tasks. Its `astro.config.mjs` also sets `security.allowedDomains`, because a production Astro build otherwise treats every request as `localhost` and rejects form posts. Set `SITE_URL` to your public URL when you build.
