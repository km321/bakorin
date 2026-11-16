---
title: Upgrade notes
description: Behavior changes from the security review fixes, and what to do before you upgrade.
---

These changes come from the November 2026 security review. Read them before you upgrade an existing app.

## JWT_SECRET is now required for bakorin start

**What changed.** `bakorin start` and anything else outside explicit dev mode refuse to boot unless `JWT_SECRET` is at least 32 characters, has at least 10 distinct characters, and is not a placeholder such as `change-me` or `dev-only`. Before, `bakorin start` silently used the public development secret unless `NODE_ENV` or `BAKORIN_ENV` was `production`, so anyone could sign their own admin tokens.

Dev mode is now explicit. `bakorin dev` sets `BAKORIN_ENV=development` and may still use the built in secret with a warning. `NODE_ENV` no longer turns dev mode on, and `bakorin start` refuses to run when `BAKORIN_ENV` is `development`, `dev`, or `test`.

**What to do.**

1. Generate a secret: `openssl rand -base64 48`.
2. Set it as `JWT_SECRET` wherever the app runs (Railway variables, Docker env, or `.env`).
3. Remove any `${JWT_SECRET:-dev-only-change-me}` fallback from `app.yaml`. Leave `jwt.secret` out, or write `${JWT_SECRET}` with no fallback.
4. If you already ran in production with the default secret, the new secret signs everyone out. That is intended: tokens signed with the public secret could have been forged. Do not put the old default in `JWT_SECRET_PREVIOUS`.

## Signup follows auth.signup

**What changed.** `POST /api/v1/auth/signup` used to accept anyone, whatever the users `create` policy said. Now `auth.signup` decides:

- `open`: anyone can sign up.
- `invite`: signup returns 403 `signup_disabled`. Admins invite people.
- `closed`: signup and invites both return 403.

When `auth.signup` is left out, it follows the auth entity's `create` policy: `public` means `open`, anything else (including the default `admin`) means `invite`. Setting `invite` or `closed` next to a public `create` policy is a schema error.

**What to do.** If your front end has a signup page, add `signup: open` under `auth:`. The Astro and Next.js starters already do. `GET /api/v1/auth/setup` now returns `{ firstAdmin, signup }`.

## Users' email and role are private

**What changed.** On the auth entity, the identity field (usually `email`), the role field, and `emailVerified` are now private: only the user and admins see them. The default users read policy is `[owner(id), admin]`. Filters and sorts on private fields are ignored for non admins, and `expand` follows the same rule.

**What to do.** Nothing, unless an ordinary user's screen showed other users' emails or roles. If it must, set `private: false` on that field. Consider changing an existing `users.read: authenticated` to `[owner(id), admin]`.

## Rate limits ignore X-Forwarded-For unless you trust a proxy

**What changed.** Rate limits used the first `X-Forwarded-For` entry, which any client can set, so rotating it got around login and signup limits. The client IP is now the socket address unless you set `TRUST_PROXY` (or `runtime.trustProxy`) to a hop count or a list of proxy CIDRs.

**What to do.** Behind one proxy, which includes Railway, set `TRUST_PROXY=1`. Without it, every visitor behind the proxy shares one rate limit bucket, so a burst of failed logins from one visitor can rate limit everyone. See [Client IP and proxies](/docs/configuration/#client-ip-and-proxies).

## Outbox rows commit with the record

**What changed.** Webhook deliveries, mail rule deliveries, and audit rows are written in the same database transaction as the create, update, or delete, on SQLite and Postgres. A change can no longer be saved without its webhook or audit row, and a failed outbox write rolls the change back with a 500. `after*` hooks still run after the commit.

**What to do.** Nothing.

## A failing after hook no longer stops the server

**What changed.** A throwing `after*` hook used to crash `bakorin start` through an unhandled rejection. Now it is logged with the request id, reported to error monitoring (Sentry, `ERROR_WEBHOOK_URL`, and the Status page), and the server keeps serving. The CLI also catches stray unhandled rejections and exceptions, and shuts down cleanly on SIGTERM, letting in flight requests finish for up to 10 seconds.

**What to do.** Watch the Status page or your error monitor for hook errors that used to show up as restarts.
