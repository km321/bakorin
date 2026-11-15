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
