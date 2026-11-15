---
title: Backup and restore
description: Snapshots, portable exports, scheduled backups to S3 or R2, and moving between SQLite and Postgres.
---

```bash
bakorin backup                  # SQLite: VACUUM INTO + portable NDJSON
bakorin backup ./offsite        # explicit destination
bakorin restore ./offsite       # snapshot or portable archive
bakorin export ./portable       # dialect agnostic NDJSON + files + app.yaml
bakorin import ./portable       # load that archive into the current dialect
```

## What a backup contains

- **SQLite:** a consistent `VACUUM INTO` copy of `app.db`, plus `app.yaml`, `hooks.ts`, the `branding/` folder, and uploads, plus a portable export.
- **Postgres:** the portable NDJSON format (all entities, file metadata, schema, uploads).

`bakorin restore` copies the backup's `branding/` folder back into the project before it boots.

Refresh tokens are not part of the portable export. Users sign in again after an import.

## Scheduled backups

```yaml
runtime:
  backups:
    interval: 24h          # or 7d
    retain: 14
    destination: ./data/backups   # or s3://bucket/prefix
```

S3 and R2 destinations list objects under the prefix and delete older stamps so `retain` is honored. When a bucket is set in the environment, backups default to `s3://$BUCKET/backups` (change the prefix with `BAKORIN_BACKUP_PREFIX`, or override everything with `BAKORIN_BACKUP_DESTINATION`).

Scheduled backups take a database lease (`backup-scheduler`) so two instances do not take the same backup.

## From the admin

Admins can take a live backup from the **Backups** page (`POST /api/v1/backups`). It writes the same snapshot and export as `bakorin backup`. Restore stays CLI only.

## Move from SQLite to Postgres

1. Run `bakorin export ./portable` on the old host.
2. Set `runtime.dialect: postgres` and `DATABASE_URL`.
3. Start once so tables exist.
4. Run `bakorin import ./portable`.

## Restore drill

```bash
bun scripts/restore-drill.ts
```

The drill takes a live backup to an S3 mock, restores the latest stamp into a temporary data directory, and checks row counts.
