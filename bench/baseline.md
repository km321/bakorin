# SQLite k6 baseline

Measured locally on 2026-11-15 against SQLite (this repo's MINI_YAML fixture) at http://127.0.0.1:4391.
k6 v0.54.0 constant-arrival-rate, 15s per scenario. Re-run with `bun scripts/bench-sqlite.ts`. Do not invent replacements.

| Operation | configured arrival/s | http requests | measured req/s | p95 (ms) |
|---|---|---|---|---|
| list | 40 | 602 | 40.1 | 1.18 |
| get | 40 | 601 | 40.1 | 1.07 |
| create | 20 | 301 | 20.1 | 2.75 |

Checks: list 200, get 200, create 201, all 100% pass. `http_req_failed` 0%.
