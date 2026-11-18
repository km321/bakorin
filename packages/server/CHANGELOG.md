# @bakorin/server

## 0.1.0-beta.1

### Minor Changes

- 70da4c7: New field types. `json` holds any JSON value (jsonb on Postgres, checked text on SQLite), with `isnull` and `like` filters, `JsonValue` in generated types, and a JSON editor in the admin UI. `richtext` holds HTML that the server cleans against an allowlist on every write, with a formatting editor in the admin UI and `RichText` renderers for Astro and React, plus `sanitizeRichText` and `richTextToPlain` from `@bakorin/sdk/richtext`.

### Patch Changes

- Updated dependencies [70da4c7]
  - @bakorin/core@0.1.0-beta.1
  - @bakorin/sdk@0.1.0-beta.1

## 0.1.0-beta.0

### Minor Changes

- f4e0b27: First public beta. Bakorin turns one app.yaml into a self hosted API with auth, CRUD, files, realtime, mail, jobs, webhooks, and an admin UI (@bakorin/server and @bakorin/core), a typed client with Astro and Next.js helpers and components (@bakorin/sdk), and a project generator with blog, marketing, SaaS, and store templates (create-bakorin).

### Patch Changes

- Updated dependencies [f4e0b27]
  - @bakorin/core@0.1.0-beta.0
