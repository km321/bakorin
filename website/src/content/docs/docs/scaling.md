---
title: Scaling
description: When SQLite is enough, and when to move to Postgres.
---

## SQLite

The default. One writer. A good fit for a single instance with a volume, such as one Railway service with `/data` mounted. Do not put the SQLite file on a network filesystem.

The repository records measured SQLite numbers in `bench/baseline.md`. Re-run `bun scripts/bench-sqlite.ts` on your own hardware rather than relying on someone else's.

## Postgres

Set `runtime.dialect: postgres` and `DATABASE_URL`. Use it when you need more than one API instance, or when SQLite write contention shows up.

With more than one instance:

- Rate limits, lockouts, leases, audit, and the webhook outbox are database tables, so they are shared.
- Scheduled backups and webhook delivery take leases (`backup-scheduler`, `webhook-dispatcher`).
- The change bus and `after*` hooks are in process. A second instance does not see the first instance's bus. Webhooks still fire because each writer enqueues to the outbox.
- Local disk is per instance, so use the S3 driver for files behind a load balancer.
- Realtime works across instances: each change is written to a log table, and the Postgres broker (`LISTEN/NOTIFY`) tells every instance to read it. See [Realtime scaling](/docs/realtime/#scaling) for measured numbers.

Scheduled jobs are claimed with a `job-run:{name}` lease, so only one instance runs a given job at a time. Each cron slot is recorded once in `_bakorin_job_runs`.


## MySQL and MariaDB

Use an existing MySQL 8.0.13+ or MariaDB 10.11+/11.x server with `runtime.dialect: mysql` and `runtime.mysql.url`. Both have full API, auth, files, job and backup support. Realtime uses the memory broker, so keep subscriptions on one API instance. See [MySQL and MariaDB](/docs/mysql/).
