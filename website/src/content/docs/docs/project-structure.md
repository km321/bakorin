---
title: Project structure
description: What lives in a Bakorin project folder.
---

Keep each client in one directory you can zip and move.

```
client/
  app.yaml          schema, policies, runtime
  hooks.ts          optional TypeScript escape hatch
  mail/             optional email templates (receipt.html, _layout.html)
  branding/         optional logo and favicon for the branding section
  .env              JWT_SECRET and DATABASE_URL
  data/app.db       SQLite (local)
  data/uploads/     local files
  data/backups/     snapshots
  bakorin.gen.ts    generated types
```

The same `app.yaml` drives SQLite or Postgres, and local files or S3 and R2.

## What create-bakorin adds

A project scaffolded with `create-bakorin` also contains:

- `README.md` with run instructions for that project
- `.env.example` and `.gitignore`
- `Dockerfile`, `.dockerignore`, and `docker-compose.yml`
- `railway.json` and `railway.toml` (health check path `/health`)
- `web/` with the Astro or Next.js starter, unless you pass `--frontend none`
- `.bakorin/` with a vendored copy of the runtime when you scaffold from a checkout with `--sdk local`

## A typical client workflow

1. Copy `examples/studio-leads` or run `bakorin init`.
2. Edit `app.yaml` for that client's entities and policies.
3. Set `JWT_SECRET` (required in production). Point `runtime.postgres.url` at Postgres if you deploy with Postgres.
4. Deploy the binary or Docker image with the project folder mounted or copied in.
5. Run `bakorin backup` on a schedule and store snapshots off the box.
6. Run `bakorin typegen` into the front end repo when the schema changes.
