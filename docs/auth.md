# Auth

Identity is email plus password on the entity marked `auth: true`.

## Routes

| Method | Path | Notes |
|---|---|---|
| POST | `/api/v1/auth/signup` | Role is forced to the non-admin default |
| POST | `/api/v1/auth/login` | Issues access + refresh tokens |
| POST | `/api/v1/auth/refresh` | Rotates refresh tokens; reuse revokes the family |
| POST | `/api/v1/auth/logout` | Revoke one token or `all: true` |
| GET | `/api/v1/auth/me` | Current user |
| POST | `/api/v1/auth/forgot-password` | Always 200 |
| POST | `/api/v1/auth/reset-password` | `{ token, password }` |
| POST | `/api/v1/auth/verify-email` | `{ token }` |
| POST | `/api/v1/auth/invites` | Admin only |
| POST | `/api/v1/auth/accept-invite` | `{ token, password, name? }` |

Access tokens are HS256 JWTs (15 minutes by default). Refresh tokens are SHA-256 hashes, rotated on use.

## Lockout and rate limits

Login, signup, forgot-password, and resend-verification are rate limited in the database (they survive restarts and multiple instances). After 5 failed logins for a known identity, Bakorin locks that account with exponential backoff (capped at 60 minutes). Unknown emails still return 401 so the lock table cannot be used to enumerate accounts.

## JWT rotation

Set `JWT_SECRET` to the new key and `JWT_SECRET_PREVIOUS` to the old key. Verify tries the current secret, then the previous one. After access tokens expire (default 15 minutes) you can drop `JWT_SECRET_PREVIOUS`.

## Mail

`MAIL_DRIVER=log` (default) prints links. `smtp` and `resend` send real mail. Links use `APP_URL`:

- `/reset-password?token=`
- `/verify-email?token=`
- `/accept-invite?token=`

These emails are queued in the mail outbox and sent in the background with retries. The admin Mail page shows them as `system: verify`, `system: reset`, and `system: invite`, with the link redacted. Override them with `mail/_auth/<kind>.html|.txt|.subject`: see [System emails](mail.md#system-emails-verify-reset-invite).

Resend setup (API key, verified domain, `MAIL_FROM`, and how to test the three emails): [Email with Resend](resend.md). Missing `RESEND_API_KEY` with `MAIL_DRIVER=resend` fails at startup. In production the message starts with `[bakorin] production startup failed`.
