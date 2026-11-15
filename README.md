# Bakorin

Bakorin is a self-hosted backend for Melton Studios client projects. One `app.yaml`, one binary, and one database per client. It gives you data, auth, policies, files, an admin UI, and a typed SDK. Nothing else.

## Quickstart

Five minutes to an Astro (or Next.js) site with Bakorin as the API: [docs/quickstart.md](docs/quickstart.md).

```bash
npx create-bakorin my-app --frontend astro --schema todo --yes
npx create-bakorin my-app --frontend astro --schema todo --mail resend --yes
bun packages/server/src/cli.ts dev --dir ./my-app
cd my-app/web && npm install && npm run dev
```

`--mail resend` writes `MAIL_DRIVER=resend` and an empty `RESEND_API_KEY=` placeholder. Never commit a real key. Resend setup: [docs/resend.md](docs/resend.md).

From this checkout:

```bash
bun install
bun test
bun run build:ui
bun run build:bin
./bakorin init ./my-client
cd my-client
../bakorin dev
```

Open `http://127.0.0.1:4371/admin/`. Sign up via the API first, then promote that user to `admin` in SQLite or with a one-line update.

```bash
curl -s http://127.0.0.1:4371/api/v1/auth/signup \
  -H 'content-type: application/json' \
  -d '{"email":"you@studio.test","password":"password123","name":"You"}'
```

From the repo, the example app is ready:

```bash
cd examples/studio-leads
bun ../../packages/server/src/cli.ts dev
```

## What a project folder contains

Keep each client in one directory you can zip and move:

```
client/
  app.yaml          schema, policies, runtime
  hooks.ts          optional TypeScript escape hatch
  .env              JWT_SECRET and DATABASE_URL
  data/app.db       SQLite (local)
  data/uploads/     local files
  data/backups/     snapshots
  bakorin.gen.ts    generated types
```

The same `app.yaml` drives SQLite or Postgres, local files or S3/R2. The production Docker image ships SQLite on a volume plus S3 for files and backups.

## Client workflow

1. Copy `examples/studio-leads` or run `bakorin init`.
2. Edit `app.yaml` for that client's entities and policies.
3. Set `JWT_SECRET` (required in production). Point `runtime.postgres.url` at Railway Postgres when you deploy.
4. Deploy the Bakorin binary or Docker image with the project folder mounted or copied in.
5. Run `bakorin backup` on a schedule. Store snapshots off-box (S3/R2 or Railway volume snapshots).
6. `bakorin typegen` into the frontend repo when the schema changes.

## app.yaml reference

```yaml
app:
  name: studio-leads
runtime:
  dialect: sqlite          # or postgres
  sqlite:
    path: ./data/app.db
  postgres:
    url: ${DATABASE_URL}
  files:
    driver: local          # or s3
    path: ./data/uploads
    bucket: ${S3_BUCKET}
    endpoint: ${S3_ENDPOINT}
  jwt:
    secret: ${JWT_SECRET}
  backups:
    interval: 24h
    retain: 14
    destination: ./data/backups   # or s3://bucket/prefix
  hooks: ./hooks.ts
  cors:
    origins: ["http://localhost:4321"]
auth:
  entity: users
  identity: email
  password: password
  role: role
  adminRole: admin
  requireVerifiedEmail: false
entities:
  users:
    display: name            # label shown for relations in the admin UI
    auth: true
    fields:
      email: { type: email, unique: true, required: true }
      password: { type: password, required: true }
      name: { type: text, required: true }
      role: { type: enum, values: [user, admin], default: user, writable: admin }
  leads:
    display: company
    fields:
      company: { type: text, required: true }
      ownerId: { type: relation, to: users, required: true }
    policies:
      read: [owner(ownerId), admin]
      create: authenticated
      update: owner(ownerId)
      delete: owner(ownerId)
webhooks:
  - entity: leads
    events: [create, update, delete]
    url: ${WEBHOOK_URL}
    secret: ${WEBHOOK_SECRET}
```

Field types: `text`, `email`, `password`, `number`, `integer`, `boolean`, `date`, `datetime`, `enum`, `file`, `relation`.

Field write locks (optional on any field):

- `writable: admin` or `adminOnly: true`: only an admin may set the field on create or update. Non-admin writes that include it return **403**.
- `writable: none` or `readonly: true`: nobody may set the field through generic CRUD. Including it returns **403**.
- The auth `role` field is always `writable: admin`, even if you omit the flag. Public signup belongs on `POST /auth/signup`, which ignores a client-supplied role. The default policy for auth-entity **create** is `admin`; do not make `users.create` public.

`auth.requireVerifiedEmail: true` blocks login until `POST /auth/verify-email` succeeds. Bakorin adds an `emailVerified` boolean on the auth entity when the schema does not already define one.

`display` on an entity picks the field used as a human label for that row. The admin table and relation selects use it instead of raw ids. If omitted, Bakorin tries `name`, `title`, `email`, then `company`, then `id`.

Policies (OR together in a list): `public`, `authenticated`, `admin`, `owner(field)`, `role(name)`. Admins bypass row filters so the admin UI can see every row. Owner fields on create/update are taken from the session. A non-admin who sends `ownerId` (or another ownership field) in the body gets **403**; omitting it still stamps the session user.

Schema changes are planned in three tiers:

- **auto**: add entity, add optional/defaulted field, add index
- **safe**: `renameFrom` on a field
- **deprecate**: dropped fields and entities stay in the database and disappear from the API
- **abort**: type changes, required without default, unique on an existing column

## Hooks and custom routes

`hooks.ts` is the only customization point. It is not a plugin system.

```ts
import type { BakorinHooks } from "@bakorin/server";

const hooks: BakorinHooks = {
  entities: {
    leads: {
      beforeCreate({ record, actor }) {
        if (actor) record.ownerId = actor.id;
        return record;
      },
      afterCreate({ record }) {
        // runs from the internal change bus after a successful write
      },
    },
  },
  routes(app) {
    app.get("/api/v1/custom/ping", (c) => c.json({ ok: true }));
  },
};

export default hooks;
```

Successful create/update/delete always emit on one in-process change bus (`entity`, `op`, `before`, `after`, `actor`). Webhooks and `after*` hooks subscribe to that bus. Realtime can subscribe later without touching CRUD.

## Backup, restore, and moving hosts

```bash
bakorin backup                  # SQLite: VACUUM INTO + portable NDJSON
bakorin backup ./offsite        # explicit destination
bakorin restore ./offsite       # snapshot or portable archive
bakorin export ./portable       # dialect-agnostic NDJSON + files + app.yaml
bakorin import ./portable       # load that archive into the current dialect
```

SQLite backups are a consistent `VACUUM INTO` copy of `app.db`, plus `app.yaml`, `hooks.ts`, and uploads. Postgres backups use the portable NDJSON format (all entities, file metadata, schema AST, uploads). Refresh tokens are not part of the portable export; users sign in again after an import.

To move SQLite to Postgres: `bakorin export ./portable` on the old host, set `runtime.dialect: postgres` and `DATABASE_URL`, start once so tables exist, then `bakorin import ./portable`.

Scheduled backups: set `runtime.backups.interval` (for example `24h`) and `retain`. Destination may be a local folder or `s3://bucket/prefix` (R2 works with `files.endpoint`). S3/R2 destinations list objects under that prefix and delete older stamps so `retain` is honored.

The live OpenAPI 3 document is `GET /api/v1/openapi.json`. Interactive docs (Swagger UI, bundled, no CDN) are at `GET /docs` and `GET /api/v1/docs`. Try-it-out uses the admin session token from `localStorage` (`bakorin_access`) when present, or a pasted bearer token. Admins can also open docs from the admin nav.

Admins can take a live backup from the admin **Backups** page (`POST /api/v1/backups`). That writes the same consistent SQLite snapshot plus portable export as `bakorin backup`. Restore stays CLI-only.

## Deploy

The production image bakes the `examples/studio-leads` project into `/project` and runs `bakorin start`. It listens on `PORT` (Railway injects this), stores SQLite on a volume at `BAKORIN_DATA_DIR` (default `/data` in the image), and sends uploads plus scheduled backups to an S3-compatible bucket when bucket credentials are set.

Health: `GET /health` (also `GET /healthz`).

`JWT_SECRET` is required when `NODE_ENV=production` or `BAKORIN_ENV=production`.

### Docker

```bash
docker build -t bakorin .
docker run --rm -p 4371:4371 \
  -e PORT=4371 \
  -e NODE_ENV=production \
  -e JWT_SECRET=... \
  -e BAKORIN_DATA_DIR=/data \
  -e BAKORIN_ADMIN_EMAIL=ada@studio.test \
  -e BAKORIN_ADMIN_PASSWORD=password123 \
  -v bakorin-data:/data \
  bakorin
```

Mount a volume at `/data` (or whatever you set as `BAKORIN_DATA_DIR`). To run a different `app.yaml`, bind-mount that project over `/project`.

### Railway (`railway up`)

1. Create a service from this Dockerfile (`railway up` from a machine that has the source tarball or git checkout).
2. Add a volume and mount it at `/data`. Set `BAKORIN_DATA_DIR=/data`.
3. Create a Railway S3-compatible bucket and attach it (or copy its credentials into the service).
4. Set `S3_ADDRESSING_STYLE=path`. Railway buckets deny virtual-hosted requests; Bun's S3Client returns Access Denied unless path-style is used.
5. Set the variables below. Railway sets `PORT`. Railway mounts the volume at `/data`; the image does not declare a Docker `VOLUME`. Set `CORS_ORIGINS` to your admin or front-end origin. Production refuses CORS `*`.
6. Health check path: `/health`.
7. Optional first-boot admin: set `BAKORIN_ADMIN_EMAIL` and `BAKORIN_ADMIN_PASSWORD`. Bakorin creates that admin only when the users table is empty; later restarts skip it.

Railway volume snapshots are a second copy, not a substitute for `bakorin backup` / scheduled S3 backups.

### Environment variables

| Variable | Required | Notes |
|---|---|---|
| `JWT_SECRET` | yes in production | Signing key for access tokens |
| `JWT_SECRET_PREVIOUS` | during rotation | Previous signing key; tokens signed with it still verify |
| `PORT` | Railway sets it | Listen port. Overrides `runtime.port` |
| `NODE_ENV` / `BAKORIN_ENV` | image sets `production` | Production mode |
| `BAKORIN_DATA_DIR` | recommended | SQLite file `$BAKORIN_DATA_DIR/app.db`; local uploads and backups live here if S3 is not configured |
| `AWS_ENDPOINT_URL` or `S3_ENDPOINT` | for S3 | Railway bucket endpoint. `AWS_ENDPOINT` is also accepted |
| `AWS_ACCESS_KEY_ID` or `S3_ACCESS_KEY` | for S3 | |
| `AWS_SECRET_ACCESS_KEY` or `S3_SECRET_KEY` | for S3 | |
| `AWS_DEFAULT_REGION` or `S3_REGION` or `AWS_REGION` | for S3 | Defaults to `auto` |
| `BUCKET` or `S3_BUCKET` | for S3 | Presence of a bucket switches files to the S3 driver and scheduled backups to `s3://$BUCKET/$BAKORIN_BACKUP_PREFIX` |
| `S3_FORCE_PATH_STYLE` or `S3_PATH_STYLE` | optional | `true` (Railway buckets) uses path-style URLs. `false` uses virtual-hosted style |
| `S3_VIRTUAL_HOSTED_STYLE` | optional | `true` / `false`. Alternative to the path-style flags |
| `S3_ADDRESSING_STYLE` | required for Railway | Must be `path` for Railway buckets. Bun's S3Client returns Access Denied with virtual-hosted style there. `virtual` is for hosts that expect virtual-hosted URLs. |
| `FILES_DRIVER` or `BAKORIN_FILES_DRIVER` | optional | Force `local` or `s3` |
| `BAKORIN_BACKUP_PREFIX` | optional | Object prefix inside the bucket. Default `backups` |
| `BAKORIN_BACKUP_DESTINATION` | optional | Override backup destination (`./dir` or `s3://bucket/prefix`) |
| `BAKORIN_ADMIN_EMAIL` | optional | First-boot admin identity |
| `BAKORIN_ADMIN_PASSWORD` | optional | First-boot admin password (min 8 chars). Ignored if any user already exists |
| `BAKORIN_ADMIN_NAME` | optional | Defaults to `Admin` |
| `DATABASE_URL` | Postgres only | Used when `runtime.dialect` is `postgres` |
| `CORS_ORIGINS` | production | Comma-separated allowed origins. Overrides `runtime.cors.origins`. Credentials and `Authorization` are allowed. |
| `BAKORIN_ALLOW_ANY_ORIGIN` | optional | Must be `true` to start in production with CORS `*`. Logs a warning. |
| `APP_URL` or `BAKORIN_APP_URL` | recommended | Front-end base URL for links in emails. Defaults to `http://127.0.0.1:$PORT` |
| `MAIL_DRIVER` | optional | `log` (default), `smtp`, or `resend`. `log` prints the link and sends nothing |
| `MAIL_FROM` | optional | From header. Defaults to `$appName <noreply@localhost>` |
| `RESEND_API_KEY` | if `MAIL_DRIVER=resend` | Resend API key. Missing key fails startup (loud error in production). Never commit a real key. |
| `SMTP_HOST` | if `MAIL_DRIVER=smtp` | SMTP hostname |
| `SMTP_PORT` | optional | Defaults to 587 |
| `SMTP_USER` | optional | SMTP username |
| `SMTP_PASS` | optional | SMTP password |
| `SMTP_SECURE` | optional | `true` for implicit TLS (port 465). STARTTLS is tried on 587 |

Path-style is the default (Bun `virtualHostedStyle: false`). **For Railway buckets set `S3_ADDRESSING_STYLE=path`.** Virtual-hosted style gets Access Denied from Bun's S3Client against those endpoints. You can also set `S3_FORCE_PATH_STYLE=true`, `S3_VIRTUAL_HOSTED_STYLE=false`, or `runtime.files.pathStyle` / `runtime.files.virtualHostedStyle` in `app.yaml`.

### Fly.io

```toml
# fly.toml
app = "client-bakorin"
[env]
  NODE_ENV = "production"
  BAKORIN_DATA_DIR = "/data"
[http_service]
  internal_port = 4371
```

Mount a volume at `/data` for SQLite, or attach Postgres and set `DATABASE_URL`.

## SDK

```ts
import { createClient } from "@bakorin/sdk";
import type { BakorinEntities } from "./bakorin.gen.ts";

const api = createClient<BakorinEntities>({
  baseUrl: "http://127.0.0.1:4371",
  getAccessToken: () => localStorage.getItem("access"),
  getRefreshToken: () => localStorage.getItem("refresh"),
  setTokens: (tokens) => {
    localStorage.setItem("access", tokens.accessToken);
    localStorage.setItem("refresh", tokens.refreshToken);
  },
});

await api.signup({ email: "you@studio.test", password: "password123", name: "You" });
await api.login({ email: "you@studio.test", password: "password123" });
await api.forgotPassword({ email: "you@studio.test" });
await api.resetPassword({ token, password: "new-password-1" });
await api.verifyEmail({ token });
await api.acceptInvite({ token, password: "password123", name: "You" });
const leads = await api.entity("leads").list({ filter: { status: "new" } });
```

### Connect a front end

`@bakorin/sdk/next` and `@bakorin/sdk/astro` wrap the same client and keep tokens in `bakorin_access` / `bakorin_refresh` cookies. Refresh is mutexed so parallel 401s share one rotation.

```ts
// Next.js Route Handler or Server Action
import { createNextClient } from "@bakorin/sdk/next";
import { cookies } from "next/headers";

const api = createNextClient({
  baseUrl: process.env.BAKORIN_URL ?? "http://127.0.0.1:4371",
  cookies: await cookies(),
});
```

```ts
// Astro page, endpoint, or middleware
import { createAstroClient } from "@bakorin/sdk/astro";

const api = createAstroClient({
  baseUrl: import.meta.env.BAKORIN_URL ?? "http://127.0.0.1:4371",
  cookies: Astro.cookies,
});
```

Point `APP_URL` at that front end so reset, verify, and invite emails use its origin (`/reset-password?token=`, `/verify-email?token=`, `/accept-invite?token=`). The admin UI at `/admin/` can invite users and resend verification without those pages.

## Security

- SQL is parameterized. Table and column names come from the AST and are identifier-checked.
- The auth role field is admin-only on every write path. Non-admin create/update that includes it returns 403. `/auth/signup` strips it instead and always assigns the non-admin default.
- Owner ids cannot be taken over: sending `ownerId` (or another ownership field) as a non-admin returns 403. Omitting it still stamps the session user. `owner()` row filters keep another user's row at 404.
- Password updates through CRUD require an admin, or the current password for self-service, and are always hashed. Role changes and password resets revoke that user's refresh tokens.
- Passwords are argon2id. Access JWTs last 15 minutes. Refresh tokens are stored as SHA-256 hashes, rotated on use, and reuse of a revoked token revokes every token for that user.
- Auth routes are rate limited in the database (shared across instances). Five failed logins lock that account with backoff.
- `JWT_SECRET` is required when `NODE_ENV=production` or `BAKORIN_ENV=production`. Set `JWT_SECRET_PREVIOUS` while rotating.
- Production refuses CORS origin `*` unless `BAKORIN_ALLOW_ANY_ORIGIN=true`.
- File downloads require a short-lived signed URL. Upload size and MIME types are set in `app.yaml`.
- Admin and docs send CSP, nosniff, frame-ancestors, Referrer-Policy, and HSTS on HTTPS.
- Audit log: `GET /api/v1/audit` (admin) and the admin Audit page.

## CLI

`init`, `dev` (watches `app.yaml` and `hooks.ts` and swaps the schema without restarting the process), `start`, `typegen`, `backup`, `restore`, `export`, `import`.

## Tests and CI

SQLite is the default:

```bash
bun test                 # SQLite, plus an in-process S3 mock for listing and retention
```

Postgres is a second job. Start Postgres, then:

```bash
export DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/bakorin
bun test tests/postgres.test.ts
```

GitHub Actions (`.github/workflows/ci.yml`) runs SQLite tests, Postgres tests against a `postgres:16` service, then a dependency audit and gitleaks scan.

Load baseline (measured, SQLite): `bench/baseline.md` via `bun scripts/bench-sqlite.ts`. Restore drill: `bun scripts/restore-drill.ts`.

To point file storage at MinIO or R2 in a real environment, set `runtime.files.driver: s3` with `bucket`, `endpoint`, `accessKey`, and `secretKey`.

Release binaries:

```bash
bun run release    # linux-x64, linux-arm64, darwin-arm64 in ./release
```

## Status of this v0.1

Works: schema compiler, 3-tier diff, SQLite and Postgres migrators (including `indexes:`), CRUD with filters/sort/expand, policies, auth (signup, login, forgot/reset, verify, invites, lockout), DB-backed rate limits, JWT rotation, signed file URLs, audit log, leases for backups and webhooks, admin UI with Backups and Audit, SDK, create-bakorin, Astro and Next starters, backup/restore/export/import including S3 retention, hooks, generated OpenAPI, compiled binary, Docker, Railway template files.

## Roadmap

Realtime (WebSocket or SSE with per-subscriber read-policy filtering, and Postgres LISTEN/NOTIFY for more than one instance) should subscribe to the existing change bus (`entity`, `op`, `before`, `after`, `actor`). Do not add a second write path. Not in v0.1.

## License

MIT. Copyright 2026 Melton Studios.
