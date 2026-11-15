# Deploy on Railway

Use this for a project scaffolded by `create-bakorin` (or a folder with `app.yaml`, `hooks.ts`, and the generated Dockerfile). Keep the git repo private until you choose otherwise.

## What to attach

1. One Railway service from the generated `Dockerfile` (`railway.json` / `railway.toml` already set `healthcheckPath` to `/health`).
2. A volume mounted at `/data`. Set `BAKORIN_DATA_DIR=/data`.
3. Optional: an S3-compatible bucket for uploads and scheduled backups.

SQLite on the volume is the default. A Postgres plugin is optional (`DATABASE_URL` plus `runtime.dialect: postgres`).

## Required variables

| Variable | Value |
|---|---|
| `JWT_SECRET` | long random string (required in production) |
| `BAKORIN_DATA_DIR` | `/data` |
| `CORS_ORIGINS` | your Astro/Next origin, comma-separated if more than one |
| `APP_URL` | public URL of the front end |

Railway injects `PORT`. Production refuses CORS `*`. Health check path: `/health`.

Optional first admin: `BAKORIN_ADMIN_EMAIL`, `BAKORIN_ADMIN_PASSWORD` (min 8). Created only while no admin exists. You can also use Create your first admin at `/admin/`.

## Optional: mail and S3

| Variable | When |
|---|---|
| `MAIL_DRIVER` | `log` (default), `smtp`, or `resend` |
| `MAIL_FROM` | From header. For Resend: `App Name <noreply@your-verified-domain.com>` |
| `RESEND_API_KEY` | Required when `MAIL_DRIVER=resend`. Set as a Railway secret. Never commit it. |
| `S3_ADDRESSING_STYLE` | `path` for Railway buckets |
| `BUCKET` or `S3_BUCKET` | turns on S3 files and `s3://...` backups |
| `S3_ENDPOINT` or `AWS_ENDPOINT_URL` | bucket endpoint |
| `S3_ACCESS_KEY` or `AWS_ACCESS_KEY_ID` | |
| `S3_SECRET_KEY` or `AWS_SECRET_ACCESS_KEY` | |
| `S3_REGION` or `AWS_DEFAULT_REGION` | defaults to `auto` |

Also accepted: `JWT_SECRET_PREVIOUS`, `BAKORIN_ADMIN_NAME`, `DATABASE_URL`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_SECURE`.

Resend walkthrough: [Email with Resend](resend.md).

## Docker locally

From the scaffolded folder (must include `.bakorin/` when generated from a checkout):

```bash
docker build -t bakorin-app .
docker run --rm -p 4371:4371 \
  -e PORT=4371 \
  -e NODE_ENV=production \
  -e JWT_SECRET=change-me-to-a-long-random-string \
  -e BAKORIN_DATA_DIR=/data \
  -e CORS_ORIGINS=https://your-frontend.example \
  -e APP_URL=https://your-frontend.example \
  -e MAIL_DRIVER=log \
  -v bakorin-data:/data \
  bakorin-app
```

Or `docker compose up --build` using the generated `docker-compose.yml`.
