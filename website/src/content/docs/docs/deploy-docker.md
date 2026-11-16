---
title: Deploy with Docker
description: Build and run the Bakorin image anywhere Docker runs, including Fly.io.
---

Every scaffolded project includes a `Dockerfile` and `docker-compose.yml`. The image runs `bakorin start`, listens on `PORT`, stores SQLite under `BAKORIN_DATA_DIR`, and uses S3 for uploads and backups when bucket credentials are set.

Health checks: `GET /health` (also `/healthz`) for liveness, and `GET /ready` for readiness (checks the database and storage, returns 503 when either fails). See [Monitoring](/docs/monitoring/).

## Run locally

From the scaffolded folder (it must include `.bakorin/` when generated from a checkout):

```bash
docker build -t bakorin-app .
docker run --rm -p 4371:4371 \
  -e PORT=4371 \
  -e NODE_ENV=production \
  -e JWT_SECRET="$(openssl rand -base64 48)" \
  -e BAKORIN_DATA_DIR=/data \
  -e CORS_ORIGINS=https://your-frontend.example \
  -e APP_URL=https://your-frontend.example \
  -e MAIL_DRIVER=log \
  -v bakorin-data:/data \
  bakorin-app
```

Or use Compose:

```bash
docker compose up --build
```

Compose forwards the mail variables from your shell. Do not bake API keys into the image.

## The repository image

The `Dockerfile` at the root of the Bakorin repository bakes the `examples/studio-leads` project into `/project`. To run a different `app.yaml`, bind mount your project over `/project`, and mount a volume at `/data`.

## Compiled binary

```bash
bun run build:bin   # ./bakorin, with the admin UI embedded
bun run release     # linux-x64, linux-arm64, darwin-arm64 in ./release
```

## Fly.io

```toml title="fly.toml"
app = "client-bakorin"
[env]
  NODE_ENV = "production"
  BAKORIN_DATA_DIR = "/data"
[http_service]
  internal_port = 4371
```

Mount a volume at `/data` for SQLite, or attach Postgres and set `DATABASE_URL`.
