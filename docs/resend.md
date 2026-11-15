# Email with Resend

Bakorin can send password reset, verify-email, and invite messages through [Resend](https://resend.com). The server already ships a Resend driver. This page is the setup checklist.

`MAIL_DRIVER=log` (the default) prints the link and does not send mail. Switch to Resend when a real inbox should receive those links.

## 1. API key

1. Create a Resend account and an API key.
2. Set `MAIL_DRIVER=resend`.
3. Set `RESEND_API_KEY` to that key in the environment (Railway variable, Docker secret, or a local `.env` that is gitignored).
4. Never put a real key in `app.yaml`, git, screenshots, or `.env.example`. The scaffold writes an empty `RESEND_API_KEY=` placeholder on purpose.

`create-bakorin` accepts `--mail resend` (or `--email resend`) and an interactive "Email provider" prompt. That writes `MAIL_DRIVER=resend`, a `MAIL_FROM` example, and the empty key placeholder.

## 2. Verify a sending domain

Resend will not deliver from `noreply@localhost`. Add your domain in the Resend dashboard and create the DNS records it shows (SPF, DKIM, and usually DMARC). Wait until the domain is verified before you send to anyone other than your own test address.

On Resend's free tier you can send to the account owner without a verified domain. Use that only to prove the driver works.

## 3. MAIL_FROM format

Use an address on the verified domain:

```
MAIL_FROM=Studio Name <noreply@mail.your-domain.com>
```

Bare addresses also work (`noreply@mail.your-domain.com`). Display name plus angle brackets is the format Bakorin writes in `.env.example`. The domain after `@` must match the verified domain (or a subdomain you verified).

`APP_URL` is the front-end origin used in the email links. Set it to the public Astro or Next.js URL, not the Bakorin API.

## 4. Production startup

If `MAIL_DRIVER=resend` and `RESEND_API_KEY` is missing or empty, Bakorin refuses to start. In production (`NODE_ENV=production` or `BAKORIN_ENV=production`) the process exits with:

```
[bakorin] production startup failed: MAIL_DRIVER=resend requires RESEND_API_KEY. ...
```

Fix: set the key, or set `MAIL_DRIVER=log` until you are ready to send.

## 5. Test the three account emails

Point `APP_URL` at the starter (`http://127.0.0.1:4321` for Astro, `http://127.0.0.1:3000` for Next.js). Sign up once, then:

| Flow | How to trigger | What you should receive |
|---|---|---|
| Verify email | Sign up, or admin "resend verification" | Subject `Verify your {app} email`. Link `/verify-email?token=`. Expires in 24 hours. |
| Password reset | Front-end `/forgot-password`, or `POST /api/v1/auth/forgot-password` | Subject `Reset your {app} password`. Link `/reset-password?token=`. Expires in 1 hour. Forgot-password always returns 200. |
| Invite | Admin UI invite, or `POST /api/v1/auth/invites` as an admin | Subject `You are invited to {app}`. Link `/accept-invite?token=`. Expires in 7 days. |

Open the link from the email (or from the Resend dashboard's event). Confirm the starter page accepts the token.

If the request never appears in Resend:

- `MAIL_DRIVER` is still `log` (check process env, not only `.env.example`)
- `RESEND_API_KEY` is empty or from a different Resend account
- `MAIL_FROM` uses an unverified domain
- the API returned an error: Bakorin logs `Resend {status}: {body}`

## Railway and Docker

Railway: set `MAIL_DRIVER=resend`, `MAIL_FROM`, `RESEND_API_KEY`, and `APP_URL` on the Bakorin service. See [Deploy on Railway](deploy-railway.md).

Docker Compose already forwards those variables from the host environment:

```bash
MAIL_DRIVER=resend MAIL_FROM='App <noreply@your-domain.com>' RESEND_API_KEY=... docker compose up
```

Do not bake the key into the image.

## SMTP

`--mail smtp` writes `MAIL_DRIVER=smtp` plus `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, and `SMTP_SECURE`. Use that when you are not on Resend.

Mail rules from `app.yaml` and `ctx.mail.send()` in hooks use the same driver and `MAIL_FROM`. See [Transactional email](mail.md).
