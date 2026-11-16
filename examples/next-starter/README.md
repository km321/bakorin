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
