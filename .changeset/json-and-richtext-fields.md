---
"@bakorin/core": minor
"@bakorin/server": minor
"@bakorin/sdk": minor
---

New field types. `json` holds any JSON value (jsonb on Postgres, checked text on SQLite), with `isnull` and `like` filters, `JsonValue` in generated types, and a JSON editor in the admin UI. `richtext` holds HTML that the server cleans against an allowlist on every write, with a formatting editor in the admin UI and `RichText` renderers for Astro and React, plus `sanitizeRichText` and `richTextToPlain` from `@bakorin/sdk/richtext`.
