---
title: Hooks and custom routes
description: hooks.ts is the one TypeScript escape hatch for lifecycle logic and custom endpoints.
---

`hooks.ts` is the only customization point. It is not a plugin system. Point `runtime.hooks` at it, or keep the default `./hooks.ts`.

```ts title="hooks.ts"
import type { BakorinHooks } from "@bakorin/server";

const hooks: BakorinHooks = {
  entities: {
    leads: {
      beforeCreate({ record, actor }) {
        if (actor) record.ownerId = actor.id;
        return record;
      },
      afterCreate({ record }) {
        // runs from the internal change bus after a successful write
      },
    },
  },
  routes(app) {
    app.get("/api/v1/custom/ping", (c) => c.json({ ok: true }));
  },
};

export default hooks;
```

## Entity hooks

| Hook | When | Return |
|---|---|---|
| `beforeCreate` | Before insert | Optionally a modified record |
| `afterCreate` | After a successful insert | Nothing |
| `beforeUpdate` | Before update | Optionally a modified record |
| `afterUpdate` | After a successful update | Nothing |
| `beforeDelete` | Before delete | Nothing |
| `afterDelete` | After a successful delete | Nothing |

Each hook receives `{ entity, record, before, actor, db, mail }`. `actor` is the signed in user or `null`. `db` is the Kysely database. `mail.send()` queues an email in the mail outbox:

```ts
await ctx.mail.send({
  to: String(ctx.record.email),
  template: "refund",           // mail/refund.html
  data: { order: ctx.record },
  idempotencyKey: `refund-${ctx.record.id}`,
});
```

Sends are never inline: they get retries, backoff, and a row in the admin delivery log. See [Email](/docs/email/#sending-from-hooks).

## Custom routes

`routes(app)` receives the Hono app. Add any route you need.

## The change bus

Every successful create, update, and delete emits one event on an in process change bus with `entity`, `op`, `before`, `after`, and `actor`, after the database transaction commits. `after*` hooks subscribe to it. Webhook deliveries, mail rule deliveries, and audit rows do not wait for the bus: they are written inside the same transaction as the record, so they commit or roll back together.

If an `after*` hook throws or its promise rejects, Bakorin logs it with the request id, reports it to error monitoring (Sentry or `ERROR_WEBHOOK_URL` when set, and the Status page), and keeps serving. The write that triggered it has already succeeded. `bakorin start` and `bakorin dev` also catch stray unhandled rejections and exceptions the same way instead of exiting.

In `bakorin dev`, saving `hooks.ts` reloads it along with `app.yaml`.
