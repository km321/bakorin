# Security notes

- Parameterized SQL. Table and column names come from the AST and are identifier-checked.
- Auth `role` is always `writable: admin`. Signup ignores a client-supplied role.
- Ownership fields cannot be taken over (403 if a non-admin sends `ownerId`).
- Passwords are argon2id. Access JWTs last 15 minutes. Refresh tokens are hashed, rotated, and reuse-detected.
- Rate limits live in the database. Failed logins lock the account after 5 tries with backoff.
- Admin and docs responses set `Content-Security-Policy` (including `frame-ancestors 'none'`), `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, and `Strict-Transport-Security` when the request is HTTPS (`x-forwarded-proto` or the URL).
- Uploads honor `runtime.files.maxBytes` and `allowedMimeTypes`. Downloads require a short-lived signed URL (`exp` + HMAC `sig`).
- Append-only `_bakorin_audit` records signup, login, failed login, reset, invite, role change, admin writes, and backups. `GET /api/v1/audit` is admin-only.
- `JWT_SECRET_PREVIOUS` keeps old access tokens valid during a rotation.
- Webhook delivery and scheduled backups take a database lease so a second instance does not double-run.
- Production refuses CORS origin `*` unless `BAKORIN_ALLOW_ANY_ORIGIN=true`.
