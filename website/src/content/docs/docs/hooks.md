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

Each hook receives `{ entity, record, before, actor, db }`. `actor` is the signed in user or `null`. `db` is the Kysely database.

## Custom routes

`routes(app)` receives the Hono app. Add any route you need.

## The change bus

Every successful create, update, and delete emits one event on an in process change bus with `entity`, `op`, `before`, `after`, and `actor`. Webhooks and `after*` hooks subscribe to it.

In `bakorin dev`, saving `hooks.ts` reloads it along with `app.yaml`.
