# Bakorin Astro starter

Sign up, sign in, sign out, forgot and reset password, accept invite, a protected
`/app` dashboard, and a `/app/tasks` page to create, finish, and delete tasks. The
pages use the components from `@bakorin/sdk/astro/*.astro`.

```bash
# terminal 1, from a Bakorin project with the todo schema
bunx bakorin dev

# terminal 2
cd examples/astro-starter
bun install
bun run dev
```

`BAKORIN_URL` defaults to `http://127.0.0.1:4371`. Open http://127.0.0.1:4321.

## Components

| Page | Components |
| --- | --- |
| `/login`, `/signup`, `/forgot-password`, `/reset-password` | `SignInForm`, `SignUpForm`, `ForgotPasswordForm`, `ResetPasswordForm` with `handleAuthForm` |
| Header | `UserMenu` (reads `Astro.locals.user`) |
| `/app` | `Gate`, `LiveList`, `FileUpload` |
| `/app/tasks` | `RecordForm` with `handleRecordForm`, `DataTable` |

`src/middleware.ts` uses `requireAuth` to protect `/app` and to set
`Astro.locals.user` on every page. Forms post to their page without JavaScript;
with it, they save through `/api/bakorin` and show errors next to each field.
`src/lib/bakorin.gen.ts` holds the types and `bakorinSchema` for the todo schema.
After you change `app.yaml`, run `bunx bakorin typegen -o web/src/lib/bakorin.gen.ts`
from the project folder.

The components use `--bk-*` CSS variables from `@bakorin/sdk/styles.css`.
`src/styles/app.css` maps them to this site's colors, and the brand colors from the
`branding` section of `app.yaml` load in `src/layouts/Base.astro`.

## Browser calls and live updates

`src/pages/api/bakorin/[...path].ts` is a pass through route: browser code calls
`/api/bakorin/...` on this site, and the route forwards to Bakorin with the
httpOnly session cookies. It refreshes expired tokens, refuses cross-site writes,
and streams realtime events. The components use it through
`createBrowserClient()` from `@bakorin/sdk/browser`, so `LiveList` and `DataTable`
stay live. The todo schema turns this on with `realtime: true` on `tasks`.

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
