#!/usr/bin/env bun

import { cmdBackup, cmdExport, cmdImport, cmdRestore } from "./cli-backup.ts";
import { cmdInit } from "./cli-init.ts";
import { cmdJobs } from "./cli-jobs.ts";
import { cmdMail } from "./cli-mail.ts";
import { cmdMigrate, cmdSchema, cmdTypegen } from "./cli-schema.ts";
import { serve } from "./cli-serve.ts";

function help(): void {
  console.log(`bakorin <command>

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
  jobs list           List cron jobs from app.yaml
  jobs run <name> [--dry-run]
                      Run a job now and print the result

A project is one folder: app.yaml, optional hooks.ts, mail/, branding/, data/, uploads.
`);
}

const command = process.argv[2] ?? "help";
switch (command) {
  case "init":
    await cmdInit();
    break;
  case "dev":
    await serve("dev");
    break;
  case "start":
    await serve("start");
    break;
  case "typegen":
    await cmdTypegen();
    break;
  case "schema":
    await cmdSchema();
    break;
  case "backup":
    await cmdBackup();
    break;
  case "restore":
    await cmdRestore();
    break;
  case "migrate":
    await cmdMigrate();
    break;
  case "export":
    await cmdExport();
    break;
  case "import":
    await cmdImport();
    break;
  case "mail":
    await cmdMail();
    break;
  case "jobs":
    await cmdJobs();
    break;
  case "help":
  case "--help":
  case "-h":
    help();
    break;
  default:
    console.error(`unknown command ${command}`);
    help();
    process.exit(1);
}
