# Transactional email (mail rules)

Bakorin can send transactional email (receipts, notifications, status changes) without writing code. You describe *when* to send in `app.yaml`, keep the message in a template file next to it, and Bakorin queues every message in a mail outbox with retries and a delivery log.

There are two layers:

1. **Mail rules in `app.yaml`** cover most cases: "when an order is created, email a receipt to the customer".
2. **`ctx.mail.send()` in hooks** is the escape hatch for anything a rule cannot express.

Both go through the same outbox. Nothing is sent inline during a request.

## A receipt for an orders entity

```yaml title="app.yaml"
entities:
  customers:
    fields:
      name: { type: text, required: true }
      email: { type: email, required: true }
  orders:
    fields:
      number: { type: text, required: true }
      email: { type: email, required: true }
      total: { type: number, required: true }
      status: { type: enum, values: [pending, paid, refunded], default: pending }
      customer: { type: relation, to: customers }

mail:
  - name: receipt
    entity: orders
    events: [create]
    to: "{{ record.email }}"
    bcc: books@your-domain.com
    replyTo: "Support <support@your-domain.com>"
    subject: "Your receipt for order {{ record.number }}"
    template: receipt
    expand: [customer]

  - name: order-paid
    entity: orders
    events: [update]
    changed: [status]
    when:
      status: paid
    to: ["{{ record.email }}", "ops@your-domain.com"]
    template: order-paid
```

```html title="mail/receipt.html"
<h1>Thanks, {{ expand.customer.name }}</h1>
<p>Order {{ record.number }} is confirmed.</p>
<table role="presentation">
  <tr><td>Total</td><td>{{ record.total }}</td></tr>
  <tr><td>Status</td><td>{{ record.status }}</td></tr>
</table>
<p><a href="{{ app.url }}/orders/{{ record.id }}">View your order</a></p>
```

```text title="mail/order-paid.subject"
Payment received for order {{ record.number }}
```

That is the whole setup. Create an order through the API or the admin and the receipt shows up in **Mail** in the admin, then goes out through your mail driver.

## Project layout

Templates live in a `mail/` folder inside the project, so the project stays portable in one folder:

```
my-app/
  app.yaml
  hooks.ts
  mail/
    _layout.html        optional shared layout
    receipt.html        HTML body
    receipt.txt         optional plain text body
    receipt.subject     optional subject (app.yaml subject wins)
```

| File | Required | Notes |
|---|---|---|
| `mail/<name>.html` | one of html or txt | The HTML body. Values are escaped |
| `mail/<name>.txt` | no | Plain text body. If missing, Bakorin generates one from the HTML |
| `mail/<name>.subject` | if the rule has no `subject` | One line. Line breaks are removed |
| `mail/_layout.html` | no | Wraps every HTML body through `{{{ body }}}` |

Template names use letters, digits, dashes, and underscores. Bakorin checks every rule against these files at startup and on reload in `bakorin dev`, so a missing template, a missing subject, or an unclosed `{{#if}}` stops the server with a message that names the file. Template files are read on every send, so edits apply without a restart.

## Rule reference

| Key | Required | Notes |
|---|---|---|
| `name` | no | Id shown in the admin and delivery log. Defaults to `mail_1`, `mail_2`, ... |
| `entity` | yes | Entity whose writes trigger the rule |
| `events` | yes | Any of `create`, `update`, `delete` |
| `to` | yes | One address or a list. Each entry can be a template like `"{{ record.email }}"` |
| `cc`, `bcc` | no | Same format as `to` |
| `replyTo` | no | One address, can be a template |
| `subject` | no | Subject template. Falls back to `mail/<template>.subject` |
| `template` | yes | File name in `mail/` without the extension |
| `when` | no | Conditions on the record, all must match (see below) |
| `changed` | no | Only with `events: [update]`. Fires when any listed field changed |
| `expand` | no | Relation fields to load and expose as `expand.<field>` |
| `maxAttempts` | no | Delivery attempts before a message is marked failed. Default `8`, 1 to 100 |

Addresses can be plain (`a@b.com`) or named (`Support <support@b.com>`). Templates in `to`, `subject`, and the other keys may only reference `record`, `before`, `expand`, `event`, and `app`, and Bakorin checks that the fields exist. A recipient that renders empty or invalid marks the delivery failed with a clear error instead of sending.

`${ENV}` interpolation works as everywhere else in `app.yaml`, so `to: ${OPS_EMAIL}` is fine.

### when

`when` is a map of field names to conditions. It is data, not code, so there is nothing to inject.

```yaml
when:
  status: paid                       # equals
  plan: { in: [pro, team] }
  country: { notIn: [XX] }
  archived: { not: true }
  trackingNumber: { exists: true }   # set and not empty
```

Each field must exist on the entity, and secret fields cannot be tested. On delete events conditions are checked against the deleted record.

### changed

`changed: [status]` fires an update rule only when `status` is different from before. Combine it with `when` for "status became paid".

### expand

`expand: [customer]` loads the related record for a relation field and exposes it as `expand.customer`. Expansion runs as the system, without read policies, so Bakorin strips the same fields it strips from webhook payloads: password hashes and every field marked `secret: true` never reach a template. The triggering record and `before` are sanitized the same way.

## Template syntax

Templates use a small handlebars-like syntax with escaping on by default.

| Syntax | Meaning |
|---|---|
| `{{ record.total }}` | Value, HTML escaped in `.html` files |
| `{{#if record.paid}} ... {{else}} ... {{/if}}` | Conditional |
| `{{#unless record.paid}} ... {{/unless}}` | Negated conditional |
| `{{#each items}} {{ this.name }} {{ @index }} {{/each}}` | Loop over a list (handy with hook data) |
| `{{! a comment }}` | Ignored |
| `{{{ body }}}` | Raw output. Only allowed for `body` inside `_layout.html` |

Only dotted paths are allowed: no function calls, helpers, or expressions. Missing values render as an empty string, and lookups never read inherited properties such as `constructor` or `__proto__`. Raw `{{{ }}}` output anywhere else is rejected at startup, so record values can never inject HTML.

Data available to rule templates:

| Name | Contents |
|---|---|
| `record` | The record after the write (or the deleted record), without secret fields |
| `before` | The record before an update |
| `expand.<field>` | Related records listed in `expand`, without secret fields |
| `event.entity`, `event.op` | What triggered the rule |
| `app.name`, `app.url` | `app.name` from app.yaml and `APP_URL` |

`_layout.html` also receives `subject` and `body`:

```html title="mail/_layout.html"
<!doctype html>
<html>
  <body style="font-family: Helvetica, Arial, sans-serif">
    <h2>{{ app.name }}</h2>
    {{{ body }}}
    <p style="color:#777">Sent by {{ app.name }}</p>
  </body>
</html>
```

## Sending from hooks

Every hook context has `ctx.mail.send()`. It queues the message in the same outbox, so it gets the same retries and shows up in the same delivery log.

```ts title="hooks.ts"
import type { BakorinHooks } from "@bakorin/server";

const hooks: BakorinHooks = {
  entities: {
    orders: {
      async afterUpdate(ctx) {
        if (ctx.record.status !== "refunded" || ctx.before?.status === "refunded") return;
        await ctx.mail.send({
          to: String(ctx.record.email),
          template: "refund",
          data: { order: { number: ctx.record.number, total: ctx.record.total } },
          idempotencyKey: `refund-${ctx.record.id}`,
        });
      },
    },
  },
};

export default hooks;
```

| Option | Notes |
|---|---|
| `to`, `cc`, `bcc` | Address or list. Used literally, never as templates |
| `replyTo` | One address |
| `template` + `data` | Renders `mail/<template>.*` with `data` (plus `app`) as the template root |
| `html`, `text` | Inline content instead of a template. Text only becomes simple HTML |
| `subject` | Required unless the template has a `.subject` file |
| `idempotencyKey` | Optional. A second send with the same key returns the first message instead of queueing another |
| `maxAttempts` | Optional, default 8 |

`send` resolves to `{ id, status, duplicate }`. It throws if the message cannot be rendered or has no valid recipient (the failed row still appears in the log). Hook data is passed through as you give it, so only include fields you want in an email. Prefer `after*` hooks: a send from a `before*` hook is queued even if the write later fails.

## Delivery, retries, and idempotency

Mail uses the same outbox design as webhooks.

- Rules subscribe to the same post-write change bus as webhooks and `after*` hooks. A rule only fires after a write succeeds.
- Messages are rendered when they are queued and stored in the `_bakorin_mail_outbox` table, so a later template edit does not change a message that is already waiting.
- A background worker holds a database lease (`mail-dispatcher`), so only one instance sends at a time even with several replicas.
- Failed sends retry with exponential backoff (100 ms doubling, capped at 60 seconds) until `maxAttempts`, then the row is marked `failed`. **Retry** in the admin queues it again.
- Sent rows are deleted after `runtime.mail.retainDays` (default 30, or `BAKORIN_MAIL_RETAIN_DAYS`).

A message is never sent twice once a send has succeeded:

- A worker claims a row by moving it from `pending` to `sending` in one conditional update, so two workers cannot both claim it. Only `pending` rows are ever sent, and only `failed` rows can be retried. A `sent` row is final.
- Every send carries the delivery id as an idempotency key. Resend receives it as the `Idempotency-Key` header and SMTP as the `Message-ID`.
- If a worker stops between handing a message to the provider and recording the result, the row is left in `sending`. With Resend it goes back to `pending` and Resend drops the duplicate by its key. With SMTP and log, which cannot deduplicate, the row is marked `failed` with "delivery outcome unknown" so a person can check before pressing Retry.
- Each rule also writes a deterministic key per record and write, so one write never queues the same rule twice.

Statuses: `pending`, `sending`, `sent`, `failed`.

## System emails (verify, reset, invite)

The built in account emails use the same outbox as mail rules: signup verification, admin **Resend verification**, password reset, admin invites, and the notice sent when someone signs up with an email that already has an account. They are queued during the request and sent in the background, so they get the same lease, retries with backoff, idempotency, and a row in the admin delivery log, labeled `system: verify`, `system: reset`, `system: invite`, or `system: existing`.

API responses do not change. `forgot-password` still returns the same `200` body whether or not the email belongs to an account, and the request never waits on the mail provider, so delivery speed or failures cannot reveal which addresses exist.

The one time links stay private:

- The `html` and `body_text` columns of a system email only hold a redacted copy, for example `/reset-password?token=[redacted]`. That is what the delivery log, the database, and backups contain.
- The real message is stored encrypted (AES-256-GCM, key derived from `JWT_SECRET`) until it is sent, then the encrypted copy is deleted.
- The admin delivery log never returns message bodies or tokens, and previews of system emails use a placeholder link (`?token=preview-token-not-valid`).
- **Retry** on a failed system email is refused once its link has expired (verify 24 hours, reset 1 hour, invite 7 days). Ask the person to request a new email instead.
- If `JWT_SECRET` changes while a system email is still waiting (and the old value is not in `JWT_SECRET_PREVIOUS`), the email is marked failed instead of sent.

With `MAIL_DRIVER=log` the server log still prints the link, because that is how you test locally. Do not use the log driver in production.

### Custom system templates

The defaults are plain and work everywhere. To brand them, add any of these files. Each file overrides only its own part, so a custom `reset.html` keeps the default subject unless you also add `reset.subject`.

```
mail/_auth/verify.html    mail/_auth/verify.txt    mail/_auth/verify.subject
mail/_auth/reset.html     mail/_auth/reset.txt     mail/_auth/reset.subject
mail/_auth/invite.html    mail/_auth/invite.txt    mail/_auth/invite.subject
mail/_auth/existing.html  mail/_auth/existing.txt  mail/_auth/existing.subject
```

Available values: `{{ link }}`, `{{ email }}`, `{{ expires }}` (for example `1 hour`), `{{ purpose }}`, `{{ app.name }}`, and `{{ app.url }}`. A custom HTML body is wrapped in `mail/_layout.html` when you have one, and a missing `.txt` is generated from the HTML.

```html title="mail/_auth/reset.html"
<h1>Reset your password</h1>
<p>Hi {{ email }}, use this link within {{ expires }}:</p>
<p><a href="{{ link }}">Choose a new password</a></p>
<p>If you did not ask for this, ignore this email.</p>
```

Bakorin checks these files at startup: every `.html` and `.txt` override must contain `{{ link }}`, and a `.subject` must not. The admin Mail page lists the three system emails under **System emails** with a preview and **Send test to me**.

## Drivers

Mail rules, hook sends, and system emails all use one driver. Set `MAIL_DRIVER` to `log` (default, prints and sends nothing), `resend`, or `smtp`, and `MAIL_FROM` for the From header. All three support lists, `cc`, `bcc`, and `replyTo`.

## Admin Mail page

**Mail** in the admin sidebar is admin only. It shows:

- Every rule with its entity, events, template, and conditions.
- Every template in `mail/`.
- A live preview against sample data or a real record you pick, with the subject, recipients, HTML, and the plain text version. The HTML renders in a sandboxed iframe with scripts disabled.
- **Send test to me**, which sends the rendered message to the signed in admin with `[Test]` in the subject.
- The delivery log with status filters and **Retry** for failed rows.

The server enforces access: `GET /api/v1/mail`, `POST /api/v1/mail/preview`, `POST /api/v1/mail/test`, `GET /api/v1/mail/deliveries`, and `POST /api/v1/mail/deliveries/:id/retry` return 401 when signed out and 403 for non-admins.

## CLI preview

```bash
bakorin mail list
bakorin mail preview receipt                       # sample data
bakorin mail preview receipt --entity orders --record <id>
bakorin mail preview order-paid --format text      # subject and plain text
bakorin mail preview receipt --format json
```

The first argument is a template or a rule name. The CLI does not start the delivery worker, so previewing never sends queued mail.
