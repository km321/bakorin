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
  restore <dir>       Restore a snapshot or portable archive
  export [dir]        Portable NDJSON archive for moving SQLite <-> Postgres
  import <dir>        Import a portable archive into the current dialect
```

Most commands accept `--dir <path>` to point at a project folder (default: the current directory). `dev` and `start` accept `--port`.

From a checkout, run the CLI with `bun run bakorin <command>` or `bun packages/server/src/cli.ts <command>`. After publish it will be `bunx bakorin <command>`.

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

See [Backup and restore](/docs/backups/).
