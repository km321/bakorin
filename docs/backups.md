# Backups and restore

```bash
bakorin backup                  # SQLite snapshot + portable export
bakorin restore ./path          # snapshot or portable archive
bakorin export ./portable
bakorin import ./portable
```

Admins can also run `POST /api/v1/backups` from the admin Backups page.

Scheduled backups use `runtime.backups.interval` (for example `24h`) and `retain`. Destination is a local folder or `s3://bucket/prefix`. A database lease (`backup-scheduler`) so two instances do not take the same backup.

Restore stays CLI-only.

## Restore drill

```bash
bun scripts/restore-drill.ts
```

The drill takes a live backup to an S3 mock, restores the latest stamp into a temp data directory, and checks row counts.

See `bench/baseline.md` for load numbers. Backup/restore timings are not recorded there unless the drill prints them.
