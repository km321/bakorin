---
title: Configuration
description: Environment variables Bakorin reads, and how they interact with app.yaml.
---

Bakorin reads `app.yaml` for structure and the environment for secrets and deployment settings. In development, the CLI loads `.env` from the project folder (`--dir`).

`JWT_SECRET` is required for `bakorin start` and anything else that is not explicit development mode. It must be at least 32 characters with at least 10 distinct characters, and not a placeholder. Generate one with `openssl rand -base64 48`. Only `bakorin dev` (which sets `BAKORIN_ENV=development`) and the test suite fall back to the built in development secret, and `bakorin dev` prints a warning when it does. `bakorin start` refuses to run when `BAKORIN_ENV` is `development`, `dev`, or `test`.

## Core

| Variable | Required | Notes |
|---|---|---|
| `JWT_SECRET` | Yes, except `bakorin dev` | Signing key for access tokens. 32 or more random characters |
| `JWT_SECRET_PREVIOUS` | During rotation | Previous key. Tokens signed with it still verify |
| `PORT` | Railway sets it | Listen port. Overrides `runtime.port` (default 4371) |
| `NODE_ENV` / `BAKORIN_ENV` | Image sets `production` | Production mode for CORS, request logs, and mail checks |
| `BAKORIN_ENV=development` | `bakorin dev` sets it | Dev mode. The only mode that may use the built in JWT secret. `bakorin start` refuses to run with it. `NODE_ENV` does not turn on dev mode |
| `TRUST_PROXY` | Behind a proxy | How many proxies to trust for the client IP, or a comma separated list of proxy CIDRs. Unset trusts none. Use `1` on Railway |
| `BAKORIN_PROXY_SECRET` | With an Astro or Next site | 32 or more random characters, the same on the site and the server. The site's pass through route and server calls send it with the visitor IP, so lockouts and rate limits apply per visitor |
| `BAKORIN_DATA_DIR` | Recommended | SQLite at `$BAKORIN_DATA_DIR/app.db`. Local uploads and backups live here when S3 is not configured |
| `DATABASE_URL` | Postgres only | Used when `runtime.dialect` is `postgres` |
| `CORS_ORIGINS` | Production | Comma separated origins. Overrides `runtime.cors.origins`. Credentials and `Authorization` are allowed |
| `BAKORIN_ALLOW_ANY_ORIGIN` | Optional | Must be `true` to start in production with CORS `*`. Logs a warning |
| `APP_URL` or `BAKORIN_APP_URL` | Recommended | Front end base URL for email links. Defaults to `http://127.0.0.1:$PORT` |

## Client IP and proxies

Rate limits, the audit log, and lockouts key on the client IP. By default that is the socket address, and `X-Forwarded-For` is ignored, because any client can send that header.

Behind a reverse proxy the socket address is the proxy, so every visitor would share one rate limit bucket. Tell Bakorin about the proxy with `TRUST_PROXY` or `runtime.trustProxy`:

| Value | Meaning |
|---|---|
| unset, `false`, `0` | Trust no proxy. Use the socket address |
| `1`, `true` | One proxy in front (Railway, Fly, Render, a single nginx). The client is the last `X-Forwarded-For` entry |
| `2` and up | That many proxies in front, for example a CDN plus a load balancer |
| `10.0.0.0/8,100.64.0.0/10` | Trust proxies in these ranges. Bakorin walks `X-Forwarded-For` from the right and stops at the first address outside them |

Only trust a proxy that overwrites or appends to `X-Forwarded-For`. If clients can reach the app directly, a trusted hop count lets them pick their own IP.

## First admin

| Variable | Notes |
|---|---|
| `BAKORIN_ADMIN_EMAIL` | First boot admin identity |
| `BAKORIN_ADMIN_PASSWORD` | At least 8 characters. Ignored once an admin exists |
| `BAKORIN_ADMIN_NAME` | Defaults to `Admin` |

Without these, `bakorin start` prints a one time setup token to the log that the **Create your first admin** form asks for. See [First admin](/docs/auth/#first-admin).

## Mail

| Variable | Notes |
|---|---|
| `MAIL_DRIVER` | `log` (default), `smtp`, or `resend` |
| `MAIL_FROM` | Defaults to `<app name> <noreply@localhost>` |
| `RESEND_API_KEY` | Required when `MAIL_DRIVER=resend`. Missing key fails startup |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_SECURE` | SMTP settings. Port defaults to 587 |

## Files and S3

| Variable | Notes |
|---|---|
| `BUCKET` or `S3_BUCKET` | Switches files to S3 and scheduled backups to `s3://$BUCKET/$BAKORIN_BACKUP_PREFIX` |
| `AWS_ENDPOINT_URL`, `S3_ENDPOINT`, or `AWS_ENDPOINT` | Bucket endpoint |
| `AWS_ACCESS_KEY_ID` or `S3_ACCESS_KEY` | |
| `AWS_SECRET_ACCESS_KEY` or `S3_SECRET_KEY` | |
| `AWS_DEFAULT_REGION`, `S3_REGION`, or `AWS_REGION` | Defaults to `auto` |
| `S3_ADDRESSING_STYLE` | `path` (required for Railway buckets) or `virtual` |
| `S3_FORCE_PATH_STYLE` or `S3_PATH_STYLE` | `true` for path style URLs |
| `S3_VIRTUAL_HOSTED_STYLE` | `true` or `false`. Alternative to the path style flags |
| `FILES_DRIVER` or `BAKORIN_FILES_DRIVER` | Force `local` or `s3` |

Path style is the default. You can also set `runtime.files.pathStyle` or `runtime.files.virtualHostedStyle` in `app.yaml`.

## Backups and webhooks

| Variable | Notes |
|---|---|
| `BAKORIN_BACKUP_PREFIX` | Object prefix inside the bucket. Default `backups` |
| `BAKORIN_BACKUP_DESTINATION` | Override the destination (`./dir` or `s3://bucket/prefix`) |
| `BAKORIN_WEBHOOK_RETAIN_DAYS` | How long delivered webhook rows are kept. Default 30 |
| `BAKORIN_ALLOW_DESTRUCTIVE` | Confirmation code for a schema change that removes something. See [Schema changes](/docs/migrations/) |
| `BAKORIN_API_DOCS` | `public` or `admin`. Who can read the OpenAPI spec. Default `admin` in production |

## Monitoring

| Variable | Notes |
|---|---|
| `BAKORIN_REQUEST_LOG` | `json`, `pretty`, or `off`. Default `json` in production, `off` otherwise |
| `SENTRY_DSN` | Send unhandled errors to Sentry. Off when unset |
| `ERROR_WEBHOOK_URL` | Post unhandled errors as JSON. Off when unset |
| `METRICS_TOKEN` | Serve Prometheus metrics at `/metrics` to requests with this bearer token |
| `BAKORIN_COMMIT` | Commit shown on the Status page. Railway's `RAILWAY_GIT_COMMIT_SHA` is used when unset |
| `BAKORIN_ALERT_EMAIL`, `BAKORIN_ALERT_WEBHOOK`, `BAKORIN_ALERT_BACKUP_MAX_AGE_HOURS` | Same as `runtime.alerts` |

See [Monitoring](/docs/monitoring/).

## Example .env

`bakorin init` and `create-bakorin` write a `.env.example` like this (values are placeholders):

```bash title=".env.example"
# Required for bakorin start: 32+ random characters. Generate one with: openssl rand -base64 48
# bakorin dev works without it and prints a warning.
JWT_SECRET=
PORT=4371
APP_URL=http://localhost:4321
CORS_ORIGINS=http://localhost:4321,http://localhost:3000

# First admin. Leave empty to create one at /admin/ on first run.
BAKORIN_ADMIN_EMAIL=
BAKORIN_ADMIN_PASSWORD=
BAKORIN_ADMIN_NAME=

MAIL_DRIVER=log
MAIL_FROM=
```
