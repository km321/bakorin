---
title: Auth
description: Email and password auth with verification, password reset, invites, token rotation, and lockout.
---

Identity is email plus password on the auth entity (the entity marked `auth: true`, or `users`). The auth entity needs an identity field, a `password` field, and an `enum` role field that includes `auth.adminRole`.

## Routes

| Method | Path | Notes |
|---|---|---|
| POST | `/api/v1/auth/signup` | Only when `auth.signup` is `open`. Role is forced to the non admin default. Always 202 with no session, see [What signup answers](#what-signup-answers) |
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

## What signup answers

`POST /auth/signup` answers the same way whether or not the email already has an account, so it cannot be used to find out who is registered:

```json
{ "data": { "ok": true, "status": "check_email", "requiresVerification": false, "message": "Check your email to confirm your address. You can sign in now." } }
```

The status is always 202. There is no user, no access token, and no session in the body. With `requireVerifiedEmail: true` the message is `Check your email to confirm your address, then sign in.` and `requiresVerification` is `true`.

- **New email**: the account is created and a verify email goes out.
- **Email that already has an account**: nothing changes on the account (the submitted password is hashed and thrown away, so both paths take about the same time). The owner gets a "Someone tried to sign up for {app} with your email" notice with a one hour password reset link, at most once an hour per address. The attempt is written to the audit log as `signup_existing`.

Validation errors (400), `signup_disabled` (403), a refused verify hook (403), and rate limits (429) do not depend on whether the email exists, so they still answer as before.

Signup does not sign anyone in. After signup, send people to the login page (or to the verify link when `requireVerifiedEmail` is on). Logging in straight after signup would tell the caller whether the password they typed matched an existing account, so the SDK does not do it for you.

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

## Admin sessions

The built in admin at `/admin/` stores an access token and a refresh token in the browser.

- Access tokens last 15 minutes by default (`runtime.jwt.accessTtlSeconds`). Refresh tokens last 30 days by default (`runtime.jwt.refreshTtlSeconds`) and rotate on every use, with a 30 second grace window for parallel refresh (see [Tokens](#tokens)).
- The admin renews the access token automatically, shortly before it expires, or when a request returns 401. Concurrent requests share a single refresh.
- File uploads and any later realtime or SSE connections use the same helper, so they also send a fresh access token.
- If refresh fails, the admin revokes the refresh token when it can, clears the browser session, and shows "Your session expired" on the sign in screen.
- Sign out always calls `POST /api/v1/auth/logout`, so the refresh token is revoked on the server. That includes the Sign out button and an idle timeout.
- To sign the admin out after a period of no pointer, key, or tab activity, set `runtime.admin.idleTimeoutMinutes`. This is off by default. When the timeout is longer than 1 minute, the admin shows a warning about 1 minute before sign-out. Activity in one tab keeps the others signed in, and sign-out in one tab signs out all of them.
- The idle timeout is enforced in the browser only. A valid access or refresh token still works if the API is called directly, so this is a safeguard for an unattended admin tab, not a server-side session limit.

```yaml
runtime:
  jwt:
    accessTtlSeconds: 900
    refreshTtlSeconds: 2592000
  admin:
    idleTimeoutMinutes: 30
```

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

A signup with an email that already has an account sends the owner a notice that links to `/reset-password?token=` (1 hour).

The Astro and Next.js starters include these pages. These emails go through the mail outbox: they are sent in the background with retries, show up in the admin Mail page delivery log with the link redacted, and can be restyled with `mail/_auth/reset.html` and friends. See [System emails](/docs/email/#system-emails-verify-reset-invite).

## Lockout and rate limits

Login, signup, forgot password, and resend verification are rate limited per client IP in the database (add your own limits to any entity with [rateLimit](/docs/app-yaml/#rate-limits), and a captcha with the [verify hook](/docs/hooks/#captcha-and-bot-checks)), so limits survive restarts and are shared across instances. The client IP is the socket address unless you trust a proxy with `TRUST_PROXY` (see [Configuration](/docs/configuration/#client-ip-and-proxies)). A client sent `X-Forwarded-For` header is ignored by default, so rotating it does not get around the limits. After 5 failed logins for an email from one IP, Bakorin locks that email for that IP with exponential backoff capped at 60 minutes, so someone guessing from their own address cannot lock the real owner out everywhere. Unknown emails go through the same password check, failures, and lock as known ones, so login does not reveal which emails have accounts. Signup answers 202 with the same body for new and existing emails, so it does not reveal them either (see [What signup answers](#what-signup-answers)).

## First admin

With `bakorin dev`, `/admin/` shows **Create your first admin** to anyone who opens it, so local setup stays one step.

With `bakorin start` (production), the form also asks for a one time setup token, so the first visitor to a fresh deploy cannot claim the admin account. While no admin exists, each boot prints a new token to the server log:

```text
[bakorin] setup token: 3q2-7Yt...
```

Copy it from the log (on Railway, the deploy logs) into the form. A token works for 24 hours and stops working once an admin exists. To skip the token, set `BAKORIN_ADMIN_EMAIL` and `BAKORIN_ADMIN_PASSWORD` (at least 8 characters) before the first start and Bakorin creates that admin at boot. Scripts can send the token as `setupToken` in the `POST /api/v1/auth/first-admin` body.

## JWT secret

`bakorin start` refuses to boot unless `JWT_SECRET` is set to at least 32 characters with at least 10 distinct characters, and is not a placeholder such as `change-me`. Generate one with `openssl rand -base64 48`. Only `bakorin dev` and the test suite fall back to the built in development secret, and `bakorin dev` prints a warning when it does. The same check applies to `JWT_SECRET_PREVIOUS` when it is set.

## JWT rotation

Set `JWT_SECRET` to the new key and `JWT_SECRET_PREVIOUS` to the old key. Verification tries the current secret, then the previous one. Once access tokens have expired you can remove `JWT_SECRET_PREVIOUS`.
