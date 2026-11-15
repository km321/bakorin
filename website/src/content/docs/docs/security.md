---
title: Security
description: What Bakorin does to keep a client backend safe by default.
---

- SQL is parameterized. Table and column names come from the compiled schema and are identifier checked.
- The auth `role` field is admin only on every write path. `/auth/signup` ignores a client supplied role and always assigns the non admin default.
- Ownership fields cannot be taken over. A non admin who sends `ownerId` gets 403. `owner()` row filters keep another user's row at 404.
- Password updates through CRUD require an admin, or the current password for self service, and are always hashed with argon2id.
- Access JWTs last 15 minutes. Refresh tokens are stored as SHA-256 hashes, rotated on use, and reuse revokes every token for that user.
- Auth routes are rate limited in the database. Five failed logins lock the account with backoff.
- `JWT_SECRET` is required in production. `JWT_SECRET_PREVIOUS` supports rotation.
- Production refuses CORS origin `*` unless `BAKORIN_ALLOW_ANY_ORIGIN=true`.
- File downloads need a short lived signed URL. Upload size and MIME types are set in `app.yaml`.
- The admin UI and API docs send `Content-Security-Policy` (including `frame-ancestors 'none'`), `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, and HSTS on HTTPS.
- The admin UI shows non-admins an Admins only screen instead of the dashboard, and the admin endpoints (`_meta`, backups, audit, webhooks, invites) return 403 to them.
- An append only audit log records signup, login, failed login, reset, invite, role change, admin writes, and backups. `GET /api/v1/audit` is admin only.
- Webhook payloads strip secret fields, including password hashes, and signatures cover the timestamp to block replays.
- Webhook delivery and scheduled backups take a database lease so a second instance does not double run.
- `MAIL_DRIVER=resend` without `RESEND_API_KEY` refuses to start.
