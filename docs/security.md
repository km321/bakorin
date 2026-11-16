# Security notes

- Parameterized SQL. Table and column names come from the AST and are identifier-checked.
- Auth `role` is always `writable: admin`. Signup ignores a client-supplied role.
- Ownership fields cannot be taken over (403 if a non-admin sends `ownerId`).
- Passwords are argon2id. Access JWTs last 15 minutes. Refresh tokens are hashed, rotated atomically, and reuse more than 30 seconds after a rotation revokes every token for the user.
- Rate limits live in the database and key on the socket address unless `TRUST_PROXY` trusts a proxy, so a client sent `X-Forwarded-For` is ignored by default. Failed logins lock the account after 5 tries with backoff.
- `bakorin start` refuses to boot without a strong `JWT_SECRET` (32+ characters, not a placeholder). The development secret is only for `bakorin dev` and tests.
- Signup follows `auth.signup` (`open`, `invite`, `closed`). Users' email, role, and `emailVerified` are private to the user and admins, and the default users read policy is `[owner(id), admin]`.
- Access tokens are checked against the database per request. Refresh rotation is atomic with a 30 second grace window.
- JSON bodies are capped at 1 MiB and uploads at `files.maxBytes` (413 above that). Active file types download as sandboxed attachments, and image or PDF uploads must match their bytes.
- Relation fields must point at records the writer can read.
- Entity names that would shadow built in routes (`auth`, `audit`, `backups`, `docs`, `files`, `mail`, `status`, `webhooks`, `_meta`) are refused.
- Webhook, mail rule, and audit rows commit in the same transaction as the record change.
- A throwing `after*` hook or a stray unhandled rejection is logged with the request id and reported, and the server keeps running.
- Admin and docs responses set `Content-Security-Policy` (including `frame-ancestors 'none'`), `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, and `Strict-Transport-Security` when the request is HTTPS (`x-forwarded-proto` or the URL).
- Uploads honor `runtime.files.maxBytes` and `allowedMimeTypes`. Downloads require a short-lived signed URL (`exp` + HMAC `sig`).
- Append-only `_bakorin_audit` records signup, login, failed login, reset, invite, role change, admin writes, and backups. `GET /api/v1/audit` is admin-only.
- `JWT_SECRET_PREVIOUS` keeps old access tokens valid during a rotation.
- Webhook delivery and scheduled backups take a database lease so a second instance does not double-run.
- Webhook payloads strip `secret` fields (including password hashes). HMAC signatures cover `timestamp + "." + body` (`x-bakorin-timestamp` plus `x-bakorin-signature`) so receivers can reject replays. See [Webhooks](webhooks.md).
- Production refuses CORS origin `*` unless `BAKORIN_ALLOW_ANY_ORIGIN=true`.
- `MAIL_DRIVER=resend` without `RESEND_API_KEY` refuses to start. In production the log line begins `[bakorin] production startup failed`.

## Backups, logs, and monitoring

- The schema copy stored in the database and in backups has JWT secrets, bucket keys, the database password, and the alert webhook replaced with `[redacted]`. Backups made before this change can contain them: treat old backup folders as secret, and rotate `JWT_SECRET` (keep the old one in `JWT_SECRET_PREVIOUS`) if one was shared.
- Backup downloads are admin only, through a 60 second link bound to one backup and re-checked against the admin's current role. No public URLs.
- `bakorin restore` verifies sha256 checksums before it changes anything and takes a safety backup first.
- Request logs and error reports leave out query strings, headers, bodies, and tokens. `/metrics` is off unless `METRICS_TOKEN` is set.
