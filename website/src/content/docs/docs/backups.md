---
title: Backup and restore
description: Snapshots with checksums, downloads from the admin, verified restores on SQLite and Postgres, and moving between them.
---

```bash
bakorin backup                          # snapshot + portable export, with checksums
bakorin backup ./offsite                # explicit destination
bakorin restore ./data/backups/<stamp> --dry-run   # verify and show what would change
bakorin restore ./data/backups/<stamp>  # back up current data, then restore
bakorin restore ./backup.tar.gz         # restore a download from the admin
bakorin export ./portable               # dialect agnostic NDJSON + files + app.yaml
bakorin import ./portable               # load that archive into the current dialect
```

## What a backup contains

Every backup is one folder named after the time it was taken (UTC), for example `2026-11-15T22-11-05.250Z`.

- **SQLite:** a consistent `VACUUM INTO` copy of `app.db`, `app.yaml`, `hooks.ts`, the `branding/` folder, uploads, and a portable export in `portable/`.
- **Postgres:** the portable format: one NDJSON file per entity, the schema, uploads, and the project files. Every table is read inside one read only `repeatable read` transaction, so the backup is a consistent snapshot even under write load, and rows are written in batches of 1000 so large tables are not held in memory.

The portable export carries records, users, file metadata, the mail and webhook outbox, the audit log, and the list of soft dropped fields. It leaves out sessions, one time auth tokens, rate limits, lockouts, and leases on purpose: they are short lived, and restoring them would bring old sessions back. People sign in again after a restore.

The stored copy of the schema never holds secrets. JWT secrets, bucket keys, the database password, and the alert webhook are replaced with `[redacted]`, because the server always reads them from `app.yaml` and the environment.

## Checksums

`manifest.json` in each backup lists every file with its sha256 and size, plus row counts per table. `bakorin restore` checks all of them before it touches anything, and stops if a file is missing, has changed, or the row counts do not match. Backups made before checksums were added still restore, with a warning that their contents cannot be verified.

## Restore

```bash
bakorin restore ./data/backups/2026-11-15T22-11-05.250Z --dry-run
```

`--dry-run` (or `--verify`) checks the checksums, prints the row counts, and compares the backup's schema with your current `app.yaml`. Nothing is changed.

Without `--dry-run`, restore:

1. Verifies the backup and stops on any mismatch.
2. Copies the backup's `branding/` folder into the project.
3. Takes a safety backup of the current data (reason `pre-restore`). Skip it with `--no-backup`.
4. Restores. A SQLite snapshot into a SQLite project replaces the database file and uploads. Anything else (Postgres, or a SQLite backup into Postgres) imports the portable copy in one transaction, so a failed import leaves the database as it was.

Stop the server before restoring SQLite. Restore is a command line action on purpose: it replaces data, and it should not be one click away in a browser.

## Download a backup

Admins can download any backup from the **Backups** page. The button asks the server for a link that works for 60 seconds, for that one backup, and only while the person is still an admin. The server streams the backup as a `.tar.gz` from the local folder or from S3. There are no public URLs.

From a script, an admin access token works directly:

```bash
curl -H "Authorization: Bearer $TOKEN" -o backup.tar.gz \
  https://api.example.com/api/v1/backups/2026-11-15T22-11-05.250Z/download
```

Restore a downloaded file on any machine that has the project folder:

```bash
bakorin restore ./studio-backup-2026-11-15T22-11-05-250Z.tar.gz --dry-run
bakorin restore ./studio-backup-2026-11-15T22-11-05-250Z.tar.gz
```

There is no upload and restore in the admin. Restoring replaces every record, so it stays on the command line where it is deliberate and where the server can be stopped first.

## Scheduled backups

```yaml
runtime:
  backups:
    interval: 24h          # or 7d
    retain: 14
    destination: ./data/backups   # or s3://bucket/prefix
```

S3 and R2 destinations list objects under the prefix and delete older stamps so `retain` is honored. When a bucket is set in the environment, backups default to `s3://$BUCKET/backups` (change the prefix with `BAKORIN_BACKUP_PREFIX`, or override everything with `BAKORIN_BACKUP_DESTINATION`).

Scheduled backups take a database lease (`backup-scheduler`) so two instances do not take the same backup. The time of the last backup shows on the admin [Status page](/docs/monitoring/), and an [alert](/docs/monitoring/#alerts) can tell you when backups stop.

Bakorin also takes a backup automatically before a schema change that renames or removes something. See [Schema changes](/docs/migrations/).

## Move from SQLite to Postgres

1. Run `bakorin export ./portable` on the old host.
2. Set `runtime.dialect: postgres` and `DATABASE_URL`.
3. Start once so tables exist.
4. Run `bakorin import ./portable`.

## Tested in CI

The test suite backs up a project, wipes it, restores it, and checks records, users, file metadata and contents, the outbox, the audit log, and branding. It runs on SQLite and on Postgres, from a backup folder and from a downloaded `.tar.gz`, and checks that a tampered backup is refused.

```bash
bun scripts/restore-drill.ts
```

The drill takes a live backup to an S3 mock, restores the latest stamp into a temporary data directory, and checks row counts.
