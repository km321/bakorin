---
title: Email
description: Send verify, reset, and invite emails with Resend or SMTP, or log the links locally.
---

Bakorin sends three account emails: verify email, password reset, and invite. Pick a driver with `MAIL_DRIVER`.

| Driver | Behavior |
|---|---|
| `log` (default) | Prints the link and sends nothing. Good for local work |
| `resend` | Sends through [Resend](https://resend.com). Needs `RESEND_API_KEY` |
| `smtp` | Sends through any SMTP server |

`MAIL_FROM` sets the From header. It defaults to `<app name> <noreply@localhost>`. `APP_URL` is the front end origin used in links.

## Resend

1. Create a Resend API key.
2. Set `MAIL_DRIVER=resend` and `RESEND_API_KEY` in the environment (a Railway variable, a Docker secret, or a gitignored `.env`).
3. Verify a sending domain in Resend and add the DNS records it shows.
4. Set `MAIL_FROM` to an address on that domain:

   ```
   MAIL_FROM=Studio Name <noreply@mail.your-domain.com>
   ```

Never put a real key in `app.yaml`, git, screenshots, or `.env.example`. `create-bakorin --mail resend` writes an empty placeholder on purpose.

If `MAIL_DRIVER=resend` and the key is missing, Bakorin refuses to start. In production the log line starts with `[bakorin] production startup failed`.

## SMTP

| Variable | Notes |
|---|---|
| `SMTP_HOST` | Required |
| `SMTP_PORT` | Defaults to 587 |
| `SMTP_USER`, `SMTP_PASS` | Credentials |
| `SMTP_SECURE` | `true` for implicit TLS on 465. STARTTLS is tried on 587 |

## Testing the three emails

| Flow | Trigger | Subject | Link | Expires |
|---|---|---|---|---|
| Verify email | Sign up, or admin "resend verification" | `Verify your {app} email` | `/verify-email?token=` | 24 hours |
| Password reset | `/forgot-password` page or `POST /api/v1/auth/forgot-password` | `Reset your {app} password` | `/reset-password?token=` | 1 hour |
| Invite | Admin UI invite or `POST /api/v1/auth/invites` | `You are invited to {app}` | `/accept-invite?token=` | 7 days |

If nothing arrives, check that `MAIL_DRIVER` is set in the process environment, the key belongs to the right account, and `MAIL_FROM` uses a verified domain. Failed Resend calls are logged as `Resend {status}: {body}`.
