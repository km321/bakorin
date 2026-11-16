# Bakorin Astro starter

Signup, login, logout, forgot/reset password, accept invite, and a protected `/app` page that lists and creates tasks.

```bash
# terminal 1, from a Bakorin project with the todo schema
bunx bakorin dev

# terminal 2
cd examples/astro-starter
bun install
bun run dev
```

`BAKORIN_URL` defaults to `http://127.0.0.1:4371`. Open http://127.0.0.1:4321.

## Browser calls and live updates

`src/pages/api/bakorin/[...path].ts` is a pass through route: browser code calls
`/api/bakorin/...` on this site, and the route forwards to Bakorin with the
httpOnly session cookies. It refreshes expired tokens, refuses cross-site writes,
and streams realtime events. The task list on `/app` uses it with
`createBrowserClient()` from `@bakorin/sdk/browser` to stay live and to toggle
tasks. The todo schema turns this on with `realtime: true` on `tasks`.
