# app.yaml reference

One file describes the app, runtime, auth, entities, policies, and webhooks.

```yaml
app:
  name: my-app
runtime:
  dialect: sqlite          # or postgres
  sqlite:
    path: ./data/app.db
  postgres:
    url: ${DATABASE_URL}
  files:
    driver: local          # or s3
    path: ./data/uploads
    maxBytes: 10485760
    allowedMimeTypes: [image/png, image/jpeg, application/pdf, text/plain]
    signedUrlTtlSeconds: 900
  jwt:
    secret: ${JWT_SECRET}
  backups:
    interval: 24h
    retain: 14
    destination: ./data/backups
  webhooks:
    retainDays: 30
  cors:
    origins: ["http://localhost:4321"]
auth:
  entity: users
  adminRole: admin
entities:
  users:
    auth: true
    fields:
      email: { type: email, unique: true, required: true }
      password: { type: password, required: true }
      name: { type: text, required: true }
      role: { type: enum, values: [user, admin], default: user, writable: admin }
  tasks:
    fields:
      title: { type: text, required: true }
      done: { type: boolean, default: false }
      ownerId: { type: relation, to: users, required: true }
    indexes:
      - [ownerId, done]
    policies:
      read: [owner(ownerId), admin]
      create: authenticated
      update: owner(ownerId)
      delete: owner(ownerId)
webhooks:
  - entity: tasks
    events: [create, update, delete]
    url: ${WEBHOOK_URL}
    secret: ${WEBHOOK_SECRET}
    maxAttempts: 10
    timeoutMs: 10000
```

Set `runtime.webhooks.retainDays` (default 30) to control how long delivered outbox rows are kept. See [Webhooks](webhooks.md).

## Branding

Optional. `branding:` takes `name`, `primaryColor`, `accentColor`, `logo`, and `favicon`. Logo and favicon are files in `branding/`. Colors are quoted hex (`"#0f766e"`). See [branding.md](branding.md).

## Mail

A top-level `mail:` list declares transactional email. Each rule names an entity, events, recipients (templates like `"{{ record.email }}"`), and a template file in `mail/`:

```yaml
mail:
  - name: receipt
    entity: orders
    events: [create]
    to: "{{ record.email }}"
    subject: "Your receipt for order {{ record.number }}"
    template: receipt          # mail/receipt.html
    expand: [customer]
```

`runtime.mail.retainDays` (default 30) controls how long sent mail rows are kept. Full reference: [Transactional email](mail.md).

## Fields

Types: `text`, `email`, `password`, `number`, `integer`, `boolean`, `date`, `datetime`, `enum`, `file`, `relation`.

Optional flags: `required`, `unique`, `index`, `default`, `values` (enum), `to` / `onDelete` (relation), `writable: admin|none`, `secret`, `description`, `renameFrom`.

## Indexes

`indexes:` is a list of field names or arrays of field names. The migrator creates them (`create index if not exists`). Single-field `index: true` still works.

## Files

Defaults: 10 MiB, a small allow-list of image/PDF/text types, 15-minute signed URLs. Set `allowedMimeTypes: ["*"]` to allow any type. Private files are not served by session cookie; the upload response includes a signed `url`.

## Diff tiers

- auto: add entity, add optional/defaulted field, add index
- safe: `renameFrom`
- deprecate: dropped fields stay in the database
- abort: type changes, required without default
