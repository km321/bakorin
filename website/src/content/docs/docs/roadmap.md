---
title: Status and roadmap
description: What works in v0.1 and what is planned.
---

Bakorin is a v0.1 public beta.

## Works today

Schema compiler, tiered schema diffs, SQLite and Postgres migrators (including `indexes:`), CRUD with filters, sorting, and expand, relations with `onDelete`, many to many relations, policies, auth (signup, login, forgot and reset password, email verification, invites, lockout), database backed rate limits, JWT rotation, signed file URLs, audit log, leases for backups and webhooks, durable signed webhooks with retries and an admin log, the admin UI with light and dark themes, Status, Backups (with download), Audit, Webhooks, and Schema pages, confirmation gated schema changes with automatic backups and `renameFrom` for fields and entities, checksummed backups with verified restores, request logs, request ids, error forwarding, `/ready`, alerts, Prometheus metrics, `bakorin schema`, the SDK, `create-bakorin`, Astro and Next.js starters, backup, restore, export, and import including S3 retention, hooks, generated OpenAPI, a compiled binary, Docker, and Railway config files. Realtime over server sent events with a Postgres broker, browser pass through routes for Astro and Next.js, and a read only MCP dev server.

## Planned

These are not in v0.1:

- **One click Railway template.** Today you create the service by hand.
- **Hosted docs.** This site is a noindex preview on the current preview domain.

There is no plugin system. `hooks.ts` is the escape hatch.
