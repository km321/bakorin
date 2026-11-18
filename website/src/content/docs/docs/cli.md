---
title: CLI
description: Every bakorin command.
---

```text
bakorin <command>

Commands:
  init [dir]          Write a starter app.yaml, hooks.ts, and .env.example
  dev                 Run with hot reload of app.yaml / hooks.ts
  start               Run without watching
  typegen [-o file]   Write bakorin.gen.ts
  schema [--format mermaid|json]  Print the schema as Mermaid or JSON
  backup [dir]        Consistent snapshot (SQLite VACUUM INTO) plus portable export
  restore <dir|file.tar.gz> [--dry-run] [--discard-pending]
                      Verify checksums, back up current data, then restore.
                      --discard-pending drops queued mail and webhooks from the backup.
                      --dry-run only verifies and shows what would change
  migrate [--plan] [--allow-destructive <code>]
                      Show or apply schema changes. Removals need the code
                      printed by --plan; a backup is taken first
  export [dir]        Portable NDJSON archive across all supported databases
  import <dir>        Import a portable archive into the current dialect
  mail list           List templates in mail/
  mail preview <template|rule> [--record <id>] [--entity name] [--format html|text|json]
                      Render a mail template against a sample or real record
```

Most commands accept `--dir <path>` to point at a project folder (default: the current directory). `dev` and `start` accept `--port`.

In a project that depends on `@bakorin/server`, run `bunx --bun bakorin <command>` or `bun run dev` (the generated `package.json` scripts call the CLI). From a source checkout, use `bun run bakorin <command>` or `bun packages/server/src/cli.ts <command>`.

## init

Writes `app.yaml`, `hooks.ts`, `.env.example`, and a `.gitignore`. Refuses to overwrite an existing `app.yaml`.

## dev and start

`dev` watches `app.yaml` and `hooks.ts` and swaps the schema in place. An invalid change logs the error and keeps the previous schema. `start` runs without watching, for production.

## typegen

```bash
bakorin typegen -o ../web/src/bakorin.gen.ts
```

## schema

Prints the schema graph from `app.yaml`. See [Schema visualizer](/docs/schema/).

## backup, restore, export, import

See [Backup and restore](/docs/backups/). `restore` accepts a backup folder or a `.tar.gz` downloaded from the admin, `--dry-run` to only verify, `--no-backup` to skip the safety backup, and `--discard-pending` to drop mail and webhooks that were still queued in the backup.

## migrate

`bakorin migrate --plan` prints what an `app.yaml` change would do. `bakorin migrate` applies additive changes and renames, and exits with code 2 when a removal needs confirmation. `bakorin migrate --allow-destructive <code>` applies removals after a backup. See [Schema changes](/docs/migrations/).

## mail

`bakorin mail list` prints the templates in `mail/`. `bakorin mail preview receipt` renders a template (or a rule by name) against sample data, and `--entity orders --record <id>` uses a real record. `--format text` prints the subject and plain text version, `--format json` prints everything. Preview never starts the delivery worker, so it does not send queued mail. See [Email](/docs/email/#cli-preview).
