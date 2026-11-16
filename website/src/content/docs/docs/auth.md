---
title: Auth
description: Email and password auth with verification, password reset, invites, token rotation, and lockout.
---

Identity is email plus password on the auth entity (the entity marked `auth: true`, or `users`). The auth entity needs an identity field, a `password` field, and an `enum` role field that includes `auth.adminRole`.

## Routes

| Method | Path | Notes |
|---|---|---|
| POST | `/api/v1/auth/signup` | Only when `auth.signup` is `open`. Role is forced to the non admin default |
| POST | `/api/v1/auth/login` | Issues access and refresh tokens |
| POST | `/api/v1/auth/refresh` | Rotates refresh tokens. Reuse revokes the family |
| POST | `/api/v1/auth/logout` | Revoke one token, or `all: true` |
| GET | `/api/v1/auth/me` | Current user |
| POST | `/api/v1/auth/forgot-password` | Always returns 200 |
| POST | `/api/v1/auth/reset-password` | `{ token, password }` |
| POST | `/api/v1/auth/verify-email` | `{ token }` |
| POST | `/api/v1/auth/resend-verification` | Send a fresh verification link |
| POST | `/api/v1/auth/invites` | Admin only. Off when `auth.signup` is `closed` |
| POST | `/api/v1/auth/accept-invite` | `{ token, password, name? }` |

## Who can sign up

`auth.signup` decides who can create an account:

| Value | `POST /auth/signup` | Admin invites |
|---|---|---|
| `open` | Anyone can sign up | Allowed |
| `invite` | Returns 403 `signup_disabled` | Allowed. This is how people join |
| `closed` | Returns 403 `signup_disabled` | Returns 403 `invites_disabled` |

When you leave it out, Bakorin follows the auth entity's `create` policy: `public` means `open`, anything else (including the default `admin`) means `invite`. Setting `invite` or `closed` while `users.create` is `public` is a schema error, because that policy would let anyone create accounts through `POST /api/v1/users`.

`GET /api/v1/auth/setup` returns `{ firstAdmin, signup }` so a front end can hide its signup form when signup is not open. The Astro and Next.js starters set `signup: open`.

## Tokens

- Access tokens are HS256 JWTs that last 15 minutes by default (`runtime.jwt.accessTtlSeconds`).
- Refresh tokens last 30 days by default, are stored as SHA-256 hashes, and rotate on every use.
- Rotation is atomic: when the same refresh token is sent several times at once (parallel server renders), every request gets the same new token, so no extra session is created.
- For 30 seconds after a rotation, the old token keeps returning that same new token. After that, reusing it counts as theft and revokes every token for that user.
- Every request checks the access token against the database. A deleted user is signed out at once, a role change takes effect on the next request, and password resets, role changes, and logout with `all: true` reject access tokens issued before them.
- Role changes and password resets revoke that user's refresh tokens.
- Passwords are hashed with argon2id.

## Email verification

Set `auth.requireVerifiedEmail: true` to block login until `POST /auth/verify-email` succeeds. Bakorin adds an `emailVerified` boolean to the auth entity if you do not define one. Verification links expire after 24 hours.

## Password reset

`forgot-password` always returns 200, so its response does not reveal whether an account exists. Reset links expire after 1 hour.

## Invites

Admins invite users from the admin UI or with `POST /api/v1/auth/invites`. The invite link points at `/accept-invite?token=` on your front end and expires after 7 days.

## Email links

Reset, verify, and invite emails link to your front end, using `APP_URL`:

- `/reset-password?token=`
- `/verify-email?token=`
- `/accept-invite?token=`

The Astro and Next.js starters include these pages. These emails go through the mail outbox: they are sent in the background with retries, show up in the admin Mail page delivery log with the link redacted, and can be restyled with `mail/_auth/reset.html` and friends. See [System emails](/docs/email/#system-emails-verify-reset-invite).

## Lockout and rate limits

Login, signup, forgot password, and resend verification are rate limited per client IP in the database, so limits survive restarts and are shared across instances. The client IP is the socket address unless you trust a proxy with `TRUST_PROXY` (see [Configuration](/docs/configuration/#client-ip-and-proxies)). A client sent `X-Forwarded-For` header is ignored by default, so rotating it does not get around the limits. After 5 failed logins for a known identity, Bakorin locks that account with exponential backoff capped at 60 minutes. Unknown emails return 401. Signup still answers 409 for an email that already has an account, and a locked account answers differently from an unknown one, so do not rely on Bakorin to hide which emails have accounts.

## First admin

On a fresh project, `/admin/` shows **Create your first admin**. The form is race safe and disappears once an admin exists. You can also set `BAKORIN_ADMIN_EMAIL` and `BAKORIN_ADMIN_PASSWORD` (at least 8 characters) before the first start.

## JWT secret

`bakorin start` refuses to boot unless `JWT_SECRET` is set to at least 32 characters with at least 10 distinct characters, and is not a placeholder such as `change-me`. Generate one with `openssl rand -base64 48`. Only `bakorin dev` and the test suite fall back to the built in development secret, and `bakorin dev` prints a warning when it does. The same check applies to `JWT_SECRET_PREVIOUS` when it is set.

## JWT rotation

Set `JWT_SECRET` to the new key and `JWT_SECRET_PREVIOUS` to the old key. Verification tries the current secret, then the previous one. Once access tokens have expired you can remove `JWT_SECRET_PREVIOUS`.
