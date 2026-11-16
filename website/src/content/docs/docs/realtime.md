---
title: Realtime
description: Live change events over server sent events, filtered per reader, with resume, backpressure, and a Postgres broker for more than one instance.
---

Realtime is off until you turn it on for an entity. Clients then open one server sent events (SSE) stream and get a `change` event each time a record they may read is created, updated, or deleted.

```yaml title="app.yaml"
entities:
  tasks:
    realtime: true # or "ids" to send only the id, not the record
    fields:
      title: { type: text, required: true }
      ownerId: { type: relation, to: users, required: true }
    policies:
      read: [owner(ownerId), admin]
```

## What a client receives

```http
GET /api/v1/realtime?entities=tasks,notes
Authorization: Bearer <access token>
```

```text
event: ready
data: {"entities":["tasks"],"lastEventId":41}

id: 42
event: change
data: {"entity":"tasks","op":"update","id":"...","at":1794801466459,"record":{...}}
```

- **Only after commit.** Events are written to a log table in the same transaction as the change, so a rolled back write never produces an event, and events arrive in commit order.
- **Filtered per reader.** Each event is checked against the entity's `read` policy for each listener. Secret fields are removed. With `realtime: ids` the record is left out and clients refetch.
- **Signed out readers** get events only for entities whose `read` policy is `public`.
- **Many to many fields** are included only when the linked entity is publicly readable (or the reader is an admin). Otherwise the field is left out of the event and the client refetches the record to see its links.

## Reliability

- **Resume.** Every event has an `id`. Reconnect with the `Last-Event-ID` header and the server replays what you missed, up to `replayEvents` events from the last `retainMinutes`, from memory or from the log table. If you are further behind than that, you get a `reset` event: refetch, then carry on.
- **Heartbeats** every `heartbeatSeconds` keep proxies and load balancers from closing an idle stream.
- **Backpressure.** A client that stops reading and builds up more than `maxBufferKb` of unsent events is disconnected with `closed` reason `slow_consumer` instead of growing server memory.
- **Session changes.** The stream closes when the access token expires (`token_expired`), on logout (`logged_out`), when the user is signed out everywhere or deleted, or when their role changes. The SDK refreshes and reconnects on its own.
- **Limits.** `maxConnections` per instance (503) and `maxPerUser` (429) answer with `Retry-After`.
- **Restarts.** On shutdown each stream gets `closed` reason `server_restart` with a randomized retry delay, so clients do not all reconnect in the same second.

## Using it from the SDK

```ts
const stop = api.subscribe("tasks", (change) => {
  if (change.op === "delete") remove(change.id);
  else upsert(change.record);
}, {
  onReset: () => reloadEverything(),
  onStatus: (status) => console.log(status), // "connecting" | "open" | "reconnecting" | "closed"
});

// later
stop();
```

All `subscribe` calls on one client share a single stream. The SDK reconnects with exponential backoff and jitter (capped at 30 seconds), honors `retry` and `Retry-After`, sends `Last-Event-ID`, and refreshes the session once on a 401. In the browser, use the pass through route so the session stays in httpOnly cookies: see [Astro](/docs/astro/#browser-calls-and-live-updates) and [Next.js](/docs/nextjs/#browser-calls-and-live-updates).

## Settings

```yaml title="app.yaml"
runtime:
  realtime:
    broker: auto          # auto, memory, or postgres
    maxConnections: 10000 # per instance
    maxPerUser: 20
    heartbeatSeconds: 15
    replayEvents: 1000
    retainMinutes: 10     # how long the log table keeps events
    maxBufferKb: 1024     # per connection, before slow_consumer
```

Environment overrides: `BAKORIN_REALTIME_BROKER`, `BAKORIN_REALTIME_MAX_CONNECTIONS`, `BAKORIN_REALTIME_MAX_PER_USER`.

The broker tells other instances that new events exist. `auto` picks Postgres `LISTEN/NOTIFY` on Postgres and in memory on SQLite. Events themselves always come from the log table, so a missed notification only delays delivery, and the broker never carries record data.

## Monitoring

The Status page shows open streams, the broker and whether it is connected, events read, slow clients dropped, and which entities have realtime on. `/metrics` exports `bakorin_realtime_connections`, `bakorin_realtime_users`, `bakorin_realtime_events_total`, `bakorin_realtime_deliveries_total`, `bakorin_realtime_frames_built_total`, `bakorin_realtime_dropped_slow_total`, `bakorin_realtime_rejected_total`, and `bakorin_realtime_broker_up`.

## Scaling

Measured with `bun run load:realtime` on one machine: 8 vCPU Intel Xeon, about 16 GB RAM, Bun 1.4.4, with the load clients on the same machine. Writes run at a fixed rate, 80 percent to a public entity and 20 percent to an owner only entity, and every connection is signed in. Every run delivered 100 percent of events with no slow client drops.

| Setup | Connections | Writes per second | Deliveries per second | Delivery latency p50 / p95 / p99 | Server CPU |
|---|---|---|---|---|---|
| SQLite, 1 instance | 1,000 | 50 | 32,039 | 5 / 9 / 25 ms | 25% of one core |
| SQLite, 1 instance | 10,000 | 50 | 319,474 | 100 / 161 / 225 ms | 75% of one core |
| SQLite, 1 instance | 10,000 | 100 | 640,039 | 188 / 339 / 456 ms | 88% of one core |
| SQLite, 1 instance | 20,000 | 50 | 633,724 | 563 / 1,373 / 2,143 ms | 89% of one core |
| Postgres, 2 instances | 10,000 | 50 | 320,396 | 52 / 89 / 111 ms | 63% each |
| Postgres, 2 instances | 20,000 | 50 | 639,165 | 146 / 553 / 700 ms | 83% each |

What this means in practice:

- **Fan out is the cost**, not writes. Plan on roughly 300,000 to 600,000 event deliveries per second per instance before latency climbs. Deliveries per second is connections listening to an entity times its writes per second.
- **Past one instance, use Postgres** with two or more instances behind a load balancer. Each instance serves its own connections, so adding instances splits the fan out. Two instances at 20,000 connections kept p99 under one second where one SQLite instance did not.
- **Under load the server batches.** Events that arrive close together go out in one write per connection, up to a 100 ms window. A single event on a quiet server still goes out immediately.
- **Keep `maxConnections` near what you measured** for your machine, so a spike gets a fast 503 and a retry instead of slowing everyone down.
- Run the load test on your own hardware: `bun run load:realtime --connections 5000 --rate 50 --duration 30`, or add `--dialect postgres --database-url ... --instances 2`.
