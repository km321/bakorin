---
title: Auth
description: Email and password auth with verification, password reset, invites, token rotation, and lockout.
---

Identity is email plus password on the auth entity (the entity marked `auth: true`, or `users`). The auth entity needs an identity field, a `password` field, and an `enum` role field that includes `auth.adminRole`.

## Routes

| Method | Path | Notes |
|---|---|---|
| POST | `/api/v1/auth/signup` | Role is forced to the non admin default |
| POST | `/api/v1/auth/login` | Issues access and refresh tokens |
| POST | `/api/v1/auth/refresh` | Rotates refresh tokens. Reuse revokes the family |
| POST | `/api/v1/auth/logout` | Revoke one token, or `all: true` |
| GET | `/api/v1/auth/me` | Current user |
| POST | `/api/v1/auth/forgot-password` | Always returns 200 |
| POST | `/api/v1/auth/reset-password` | `{ token, password }` |
| POST | `/api/v1/auth/verify-email` | `{ token }` |
| POST | `/api/v1/auth/resend-verification` | Send a fresh verification link |
| POST | `/api/v1/auth/invites` | Admin only |
| POST | `/api/v1/auth/accept-invite` | `{ token, password, name? }` |

## Tokens

- Access tokens are HS256 JWTs that last 15 minutes by default (`runtime.jwt.accessTtlSeconds`).
- Refresh tokens last 30 days by default, are stored as SHA-256 hashes, and rotate on every use.
- Reusing a revoked refresh token revokes every token for that user.
- Role changes and password resets revoke that user's refresh tokens.
- Passwords are hashed with argon2id.

## Email verification

Set `auth.requireVerifiedEmail: true` to block login until `POST /auth/verify-email` succeeds. Bakorin adds an `emailVerified` boolean to the auth entity if you do not define one. Verification links expire after 24 hours.

## Password reset

`forgot-password` always returns 200 so it cannot be used to discover accounts. Reset links expire after 1 hour.

## Invites

Admins invite users from the admin UI or with `POST /api/v1/auth/invites`. The invite link points at `/accept-invite?token=` on your front end and expires after 7 days.

## Email links

Reset, verify, and invite emails link to your front end, using `APP_URL`:

- `/reset-password?token=`
- `/verify-email?token=`
- `/accept-invite?token=`

The Astro and Next.js starters include these pages. These emails go through the mail outbox: they are sent in the background with retries, show up in the admin Mail page delivery log with the link redacted, and can be restyled with `mail/_auth/reset.html` and friends. See [System emails](/docs/email/#system-emails-verify-reset-invite).

## Lockout and rate limits

Login, signup, forgot password, and resend verification are rate limited in the database, so limits survive restarts and are shared across instances. After 5 failed logins for a known identity, Bakorin locks that account with exponential backoff capped at 60 minutes. Unknown emails still return 401 so the lock table cannot be used to enumerate accounts.

## First admin

On a fresh project, `/admin/` shows **Create your first admin**. The form is race safe and disappears once an admin exists. You can also set `BAKORIN_ADMIN_EMAIL` and `BAKORIN_ADMIN_PASSWORD` (at least 8 characters) before the first start.

## JWT rotation

Set `JWT_SECRET` to the new key and `JWT_SECRET_PREVIOUS` to the old key. Verification tries the current secret, then the previous one. Once access tokens have expired you can remove `JWT_SECRET_PREVIOUS`.
