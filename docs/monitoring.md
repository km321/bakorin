# Monitoring

Everything here is built in and off or quiet by default. Turn on what you need with environment variables or `runtime.alerts` in `app.yaml`.

| Feature | Turn it on | Default |
|---|---|---|
| Request logs | `BAKORIN_REQUEST_LOG=json` | JSON in production, off otherwise |
| Request id | always | `X-Request-Id` on every response |
| Error tracking | `SENTRY_DSN` and/or `ERROR_WEBHOOK_URL` | off |
| Health and readiness | always | `/health`, `/ready` |
| Status page | always, admins only | Admin, **Status** |
| Alerts | `runtime.alerts` | off |
| Metrics | `METRICS_TOKEN` | off (`/metrics` returns 404) |

## Request logs

With `BAKORIN_REQUEST_LOG=json` (the default when `NODE_ENV=production`), each request writes one line to stdout:

```json
{"ts":"2026-11-15T23:41:07.112Z","level":"info","msg":"request","requestId":"8c1f0f1e-0f8a-4f2a-9b52-7d4d3c6f1b9e","method":"GET","path":"/api/v1/leads","status":200,"durationMs":4.2,"userId":"a9c09a7f-3068-414c-80e1-3eb6944a9193"}
```

Logs never include query strings, headers, request or response bodies, or tokens. `level` is `warn` for 4xx and `error` for 5xx. `/health`, `/ready`, and `/metrics` are not logged unless they fail. `pretty` prints one short line per request for local work, and `off` turns logging off.

## Request ids

Every response carries `X-Request-Id`. If a proxy sends an `X-Request-Id` made of letters, digits, dots, dashes, and underscores (8 to 128 characters), Bakorin keeps it; otherwise it makes a new one. The id is in the request log, in error reports, on the Status page, and in the JSON body of a 500 response:

```json
{"error":{"code":"internal","message":"Something went wrong on the server.","requestId":"8c1f0f1e-..."}}
```

## Error tracking

Unhandled errors are kept in memory (the last 50) for the Status page. Forwarding is off unless you set one or both of these:

- `SENTRY_DSN`: sends each error to Sentry (or any Sentry compatible service such as GlitchTip) with the request id, method, path, release, and stack.
- `ERROR_WEBHOOK_URL`: posts each error as JSON (`type: "bakorin.error"`) to any URL, for example a Slack workflow or your own endpoint.

Error messages are scrubbed before they leave the server: email addresses, bearer tokens, JWTs, long secret looking strings, and passwords in URLs are replaced. Bodies and query strings are never sent.

## Health and readiness

| Path | Use it for | Checks |
|---|---|---|
| `GET /health` | liveness: restart the container if this fails | the process answers |
| `GET /ready` | readiness: send traffic only when this passes | a database query, and that storage is writable (local folder) or reachable (S3), each with a 3 second timeout |

`/ready` returns `503` with which check failed. Both are public and return no secrets.

## Status page

Admins get a **Status** page in the admin UI (`GET /api/v1/status`, admin only). It shows:

- uptime, version, and commit
- database type and size
- the email and webhook queues: waiting, retrying, failed, and the age of the oldest waiting item
- failed deliveries, each with **Retry** and **Discard**
- recent server errors with their request ids
- the last backup, and whether it is overdue
- which monitoring features are on

Discarded deliveries stay in the delivery log with status `discarded` and no longer count as failures.

The commit comes from `BAKORIN_COMMIT`, or from what the host provides (`RAILWAY_GIT_COMMIT_SHA`, `GIT_COMMIT`, `SOURCE_COMMIT`, `RENDER_GIT_COMMIT`). The page refreshes every 30 seconds, follows your [branding](branding.md), and meets WCAG AA contrast in light and dark mode.

## Alerts

```yaml
runtime:
  alerts:
    email: ops@example.com            # or a list
    webhook: ${ALERT_WEBHOOK_URL}     # optional JSON POST
    backupMaxAgeHours: 48             # optional
    checkIntervalMinutes: 15          # default 15
```

Bakorin checks two conditions:

- **Failed deliveries:** an email or webhook failed after all its retries.
- **Backups overdue:** no backup in `backupMaxAgeHours`.

Each condition sends one alert when it starts and one when it clears, not one per check. Email alerts go through the normal [mail](mail.md) setup. Webhook alerts are sent directly, so they still arrive when mail is the thing that is failing. One instance checks at a time (database lease `alerts`). The same settings can come from `BAKORIN_ALERT_EMAIL`, `BAKORIN_ALERT_WEBHOOK`, and `BAKORIN_ALERT_BACKUP_MAX_AGE_HOURS`.

## Metrics

Set `METRICS_TOKEN` to serve Prometheus metrics at `/metrics`. Requests must send the token:

```yaml
# prometheus.yml
scrape_configs:
  - job_name: bakorin
    scheme: https
    authorization:
      credentials: <METRICS_TOKEN>
    static_configs:
      - targets: ["api.example.com"]
```

Metrics include `bakorin_up`, `bakorin_info`, `bakorin_uptime_seconds`, `bakorin_http_requests_total` (by method and status), `bakorin_http_request_duration_seconds`, `bakorin_errors_total`, `bakorin_outbox_items` (by queue and state), `bakorin_outbox_oldest_pending_seconds`, `bakorin_db_size_bytes`, and `bakorin_last_backup_timestamp_seconds`. Paths are not used as labels, so the number of series stays small.

Without `METRICS_TOKEN`, `/metrics` returns 404.
