# Connecting Next.js

Use `@bakorin/sdk/next` from Server Actions, Route Handlers, and Server Components. Pass `cookies()` from `next/headers`.

```ts
import { createNextClient } from "@bakorin/sdk/next";
import { cookies } from "next/headers";

export async function api() {
  return createNextClient({
    baseUrl: process.env.BAKORIN_URL ?? "http://127.0.0.1:4371",
    cookies: await cookies(),
  });
}
```

`cookies().set` only works in Server Actions and Route Handlers. Keep login/signup in `"use server"` actions so the SDK can write `bakorin_access` / `bakorin_refresh`.

Protect `/app` with `middleware.ts` that calls `GET /api/v1/auth/me` with the access cookie.

The starter in `examples/next-starter` (and `create-bakorin --frontend next`) has the same pages as the Astro starter.

Set `CORS_ORIGINS` to the Next origin (`http://localhost:3000` locally).

## Browser calls and live updates

For client components, add the pass through route. Client code calls `/api/bakorin/...` on your own site, and the route forwards to Bakorin with the httpOnly session cookies.

```ts title="app/api/bakorin/[...path]/route.ts"
import { createNextProxy } from "@bakorin/sdk/next";

export const dynamic = "force-dynamic";
export const { GET, POST, PATCH, PUT, DELETE } = createNextProxy({
  baseUrl: process.env.BAKORIN_URL ?? "http://127.0.0.1:4371",
});
```

```tsx title="app/app/live-tasks.tsx"
"use client";
import { useEffect } from "react";
import { createBrowserClient } from "@bakorin/sdk/browser";

export function LiveTasks() {
  useEffect(() => createBrowserClient().subscribe("tasks", (change) => {
    // update local state from change.op, change.id, change.record
  }), []);
  return null;
}
```

The route refreshes expired tokens, turns auth responses into cookies, refuses writes from other sites (403 without a matching `Origin`), and streams [realtime](realtime.md) events. The options are the same as the [Astro route](connecting-astro.md#browser-calls-and-live-updates). The starter's `/app` page uses it for a live task list with a done toggle.


> **Set BAKORIN_PROXY_SECRET in production.** Without it, Bakorin sees every visitor as your site's server, so one person can lock a user out for everyone and a public live page serves only 20 anonymous visitors in total. Set the same value on the site and the Bakorin server. The Next route reads the visitor IP from the right end of `X-Forwarded-For`, which is correct behind one platform or proxy (Vercel, Railway, Netlify, Fly, nginx). If the site is reachable directly, pass your own `getClientIp`.
