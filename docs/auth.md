# Auth

Identity is email plus password on the entity marked `auth: true`.

## Routes

| Method | Path | Notes |
|---|---|---|
| POST | `/api/v1/auth/signup` | Only when `auth.signup` is `open`. Role is forced to the non-admin default |
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

Login, signup, forgot-password, and resend-verification are rate limited per client IP in the database (they survive restarts and multiple instances). Entities can add `rateLimit:` per action, and a `verify` hook in `hooks.ts` can require a captcha (sent as `X-Bakorin-Verify`) on signup and signed out creates. In production the first admin form needs a one time setup token printed to the server log, unless `BAKORIN_ADMIN_EMAIL` and `BAKORIN_ADMIN_PASSWORD` seed it. Refresh rotation is atomic with a 30 second grace window that returns the same new token to parallel requests; later reuse revokes every token for the user. Access tokens are checked against the database on every request, so deleted users, role changes, password resets, and logout everywhere take effect at once. The client IP is the socket address unless `TRUST_PROXY` is set, so a client sent `X-Forwarded-For` cannot dodge the limits. After 5 failed logins for a known identity, Bakorin locks that account with exponential backoff (capped at 60 minutes). Unknown emails still return 401 so the lock table cannot be used to enumerate accounts.

## JWT rotation

Set `JWT_SECRET` to the new key and `JWT_SECRET_PREVIOUS` to the old key. Verify tries the current secret, then the previous one. After access tokens expire (default 15 minutes) you can drop `JWT_SECRET_PREVIOUS`.

## Mail

`MAIL_DRIVER=log` (default) prints links. `smtp` and `resend` send real mail. Links use `APP_URL`:

- `/reset-password?token=`
- `/verify-email?token=`
- `/accept-invite?token=`

These emails are queued in the mail outbox and sent in the background with retries. The admin Mail page shows them as `system: verify`, `system: reset`, and `system: invite`, with the link redacted. Override them with `mail/_auth/<kind>.html|.txt|.subject`: see [System emails](mail.md#system-emails-verify-reset-invite).

Resend setup (API key, verified domain, `MAIL_FROM`, and how to test the three emails): [Email with Resend](resend.md). Missing `RESEND_API_KEY` with `MAIL_DRIVER=resend` fails at startup. In production the message starts with `[bakorin] production startup failed`.

## Who can sign up

`auth.signup` decides who can create an account:

| Value | `POST /auth/signup` | Admin invites |
|---|---|---|
| `open` | Anyone can sign up | Allowed |
| `invite` | Returns 403 `signup_disabled` | Allowed. This is how people join |
| `closed` | Returns 403 `signup_disabled` | Returns 403 `invites_disabled` |

When you leave it out, Bakorin follows the auth entity's `create` policy: `public` means `open`, anything else (including the default `admin`) means `invite`. Setting `invite` or `closed` while `users.create` is `public` is a schema error, because that policy would let anyone create accounts through `POST /api/v1/users`.

`GET /api/v1/auth/setup` returns `{ firstAdmin, signup }` so a front end can hide its signup form when signup is not open. The Astro and Next.js starters set `signup: open`.

## JWT secret

`bakorin start` refuses to boot unless `JWT_SECRET` is at least 32 characters with at least 10 distinct characters and is not a placeholder. Generate one with `openssl rand -base64 48`. Only `bakorin dev` and tests use the built in development secret.
