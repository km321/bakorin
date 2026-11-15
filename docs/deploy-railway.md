# Deploy on Railway

This is the template checklist. The service must stay private until you choose to publish the git repo.

## Services

1. **Bakorin API** from this Dockerfile (`railway.json` / `railway.toml` already set `healthcheckPath` to `/health`).
2. **Volume** mounted at `/data`. Set `BAKORIN_DATA_DIR=/data`.
3. **Bucket** (Railway bucket or any S3-compatible store) for uploads and scheduled backups. Attach it so the service receives the reference variables below.

A Postgres plugin is optional. SQLite on the volume is the default.

## Variables the template must set

| Variable | Value |
|---|---|
| `BAKORIN_DATA_DIR` | `/data` |
| `S3_ADDRESSING_STYLE` | `path` |
| `JWT_SECRET` | generated (long random) |
| `CORS_ORIGINS` | your Astro/Next origin, comma-separated if more than one |
| `APP_URL` | public URL of the front end |
| `MAIL_DRIVER` | `log`, `smtp`, or `resend` |
| `MAIL_FROM` | From header. For Resend: `App Name <noreply@your-verified-domain.com>` |
| `RESEND_API_KEY` | Required when `MAIL_DRIVER=resend`. Set the Railway secret; never commit it. Missing key fails startup. |

Bucket reference variables (names depend on the plugin; Bakorin accepts either style):

- `BUCKET` or `S3_BUCKET`
- `S3_ENDPOINT` or `AWS_ENDPOINT_URL`
- `S3_ACCESS_KEY` or `AWS_ACCESS_KEY_ID`
- `S3_SECRET_KEY` or `AWS_SECRET_ACCESS_KEY`
- `S3_REGION` or `AWS_DEFAULT_REGION` (defaults to `auto`)

Optional: `JWT_SECRET_PREVIOUS`, `BAKORIN_ADMIN_EMAIL`, `BAKORIN_ADMIN_PASSWORD`, `DATABASE_URL`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_SECURE`.

Resend walkthrough: [Email with Resend](resend.md).

Railway injects `PORT`. Production refuses CORS `*`. Health check path: `/health`.

## Docker elsewhere

```bash
docker build -t bakorin .
docker run --rm -p 4371:4371 \
  -e PORT=4371 \
  -e NODE_ENV=production \
  -e JWT_SECRET=... \
  -e BAKORIN_DATA_DIR=/data \
  -e CORS_ORIGINS=https://your-frontend.example \
  -e APP_URL=https://your-frontend.example \
  -e MAIL_DRIVER=log \
  -v bakorin-data:/data \
  bakorin
```

Or `docker compose up --build` using the repo `docker-compose.yml`.
