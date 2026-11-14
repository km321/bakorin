# Bakorin

Bakorin is a self-hosted backend for Melton Studios client projects. One `app.yaml`, one binary, and one database per client. It gives you data, auth, policies, files, an admin UI, and a typed SDK. Nothing else.

## Quickstart

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

Production uses Postgres plus S3 or R2. The same `app.yaml` drives both.

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
auth:
  entity: users
  identity: email
  password: password
  role: role
  adminRole: admin
entities:
  leads:
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

Policies (OR together in a list): `public`, `authenticated`, `admin`, `owner(field)`, `role(name)`. Admins bypass row filters so the admin UI can see every row. Owner fields on create/update are taken from the session, never from the client.

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

Scheduled backups: set `runtime.backups.interval` (for example `24h`) and `retain`. Destination may be a local folder or `s3://bucket/prefix` (R2 works with `files.endpoint`).

## Deploy

### Docker

```bash
docker build -t bakorin .
docker run --rm -p 4371:4371 \
  -e NODE_ENV=production \
  -e JWT_SECRET=... \
  -e DATABASE_URL=postgres://... \
  -v $PWD/client:/project \
  bakorin
```

The image expects `/project/app.yaml`.

### Railway

1. New project, add a Postgres plugin.
2. Deploy this repo (or the image). Set `JWT_SECRET` and `DATABASE_URL`.
3. Copy the client folder into the service, or set the start command to `bakorin start --dir /project`.
4. Put backups on a volume or `s3://`. Railway volume snapshots are a second copy, not a substitute for `bakorin backup`.

### Fly.io

```toml
# fly.toml
app = "client-bakorin"
[env]
  NODE_ENV = "production"
[http_service]
  internal_port = 4371
```

Attach Fly Postgres, set secrets, mount a volume at `/project/data` if you stay on SQLite.

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

await api.login({ email: "you@studio.test", password: "password123" });
const leads = await api.entity("leads").list({ filter: { status: "new" } });
```

Next.js and Astro helpers live at `@bakorin/sdk/next` and `@bakorin/sdk/astro`. They read `bakorin_access` / `bakorin_refresh` cookies. Refresh is mutexed so parallel 401s share one rotation.

## Security

- SQL is parameterized. Table and column names come from the AST and are identifier-checked.
- Owner ids on writes are overwritten from the session unless the actor is an admin.
- Passwords are argon2id. Access JWTs last 15 minutes. Refresh tokens are stored as SHA-256 hashes, rotated on use, and reuse of a revoked token revokes every token for that user.
- Auth routes are rate limited.
- `JWT_SECRET` is required when `NODE_ENV=production` or `BAKORIN_ENV=production`.
- File downloads require the uploader or an admin.

## CLI

`init`, `dev` (watches `app.yaml` and `hooks.ts` and swaps the schema without restarting the process), `start`, `typegen`, `backup`, `restore`, `export`, `import`.

## Status of this v0.1

Works: schema compiler, 3-tier diff, SQLite migrator, CRUD with filters/sort/expand, policies, auth, local files, webhooks, admin UI, SDK, backup/restore/export/import, hooks, compiled binary, Docker.

Stubbed or later: S3 file listing depends on the bucket API; Postgres tests run only when `DATABASE_URL` is set; scheduled S3 retention listing is best-effort; OpenAPI is a generated sketch.

## Roadmap

Realtime (WebSocket or SSE with per-subscriber read-policy filtering, and Postgres LISTEN/NOTIFY for more than one instance) should subscribe to the existing change bus (`entity`, `op`, `before`, `after`, `actor`). Do not add a second write path. Not in v0.1.

## License

MIT. Copyright 2026 Melton Studios.
