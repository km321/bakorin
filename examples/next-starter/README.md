# Bakorin Next.js starter

App Router pages for signup, login, logout, forgot/reset password, accept invite, and a protected `/app` list.

```bash
bunx bakorin dev
cd examples/next-starter
bun install
bun run dev
```

`BAKORIN_URL` defaults to `http://127.0.0.1:4371`. Open http://127.0.0.1:3000.

## Browser calls and live updates

`app/api/bakorin/[...path]/route.ts` is a pass through route: client components
call `/api/bakorin/...` on this site, and the route forwards to Bakorin with the
httpOnly session cookies. It refreshes expired tokens, refuses cross-site writes,
and streams realtime events. `app/app/live-tasks.tsx` uses it with
`createBrowserClient()` from `@bakorin/sdk/browser` to keep the list live. The
todo schema turns this on with `realtime: true` on `tasks`.

## In production: set BAKORIN_PROXY_SECRET

Set the same `BAKORIN_PROXY_SECRET` (32 or more random characters, for example
`openssl rand -base64 48`) on this site and on the Bakorin server. The site then
names each visitor's IP to Bakorin, so login lockouts and rate limits apply per
visitor. Without it, Bakorin sees every visitor as this site's server: one person
can lock a user out for everyone, and a public live page serves only 20 anonymous
visitors in total.

The session refresh cookie is only sent to `/api/bakorin`. When a page finds the
session expired, it sends the browser to `/api/bakorin/-/refresh?next=...`, which
renews it and comes back. Sign out goes to `/api/bakorin/-/logout`.

The visitor IP is read from the right end of `X-Forwarded-For`, which is right when
the site runs behind one platform or proxy (Vercel, Railway, Netlify, Fly, nginx).
If the site is reachable directly, pass your own `getClientIp` to `createNextProxy`
and `clientIp` to `createNextClient`, or a visitor could pick their own address.
