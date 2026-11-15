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
```

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
