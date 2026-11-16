# Scaling notes

## SQLite

Default. One writer. Fine for a single Railway instance plus a volume at `/data`. Use the compiled binary or Docker image. Do not put the SQLite file on a network filesystem.

Measured SQLite list/get/create numbers (this machine, this commit) live in `bench/baseline.md`. On 2026-11-15 that file recorded list 40.1 req/s (p95 1.18 ms), get 40.1 req/s (p95 1.07 ms), and create 20.1 req/s (p95 2.75 ms) at the configured arrival rates. Re-run `bun scripts/bench-sqlite.ts` rather than inventing replacements.

## Postgres

Set `runtime.dialect: postgres` and `DATABASE_URL`. Use this when you need more than one API instance, or when SQLite write contention shows up.

Multiple instances:

- Rate limits, lockouts, leases, audit, and webhook outbox are database tables, so they are shared.
- Scheduled backups and webhook draining take leases (`backup-scheduler`, `webhook-dispatcher`).
- The change bus and after-hooks are in-process. A second instance does not see the first instance's bus. Webhooks still fire because each writer enqueues to `_bakorin_webhook_outbox`.

Files: local disk is per-instance; use the S3 driver behind a load balancer.

## What this is not

Realtime fan-out across instances is not in v0.1. Subscribe to the existing change bus later (SSE/WebSocket, or Postgres LISTEN/NOTIFY).

Scheduled jobs are claimed with a `job-run:{name}` lease, so only one instance runs a given job at a time. Each cron slot is recorded once in `_bakorin_job_runs`.
