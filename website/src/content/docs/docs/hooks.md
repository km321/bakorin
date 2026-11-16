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

## Captcha and bot checks

`verify` runs before signup and before every signed out create (public forms). Return `true` to let the request through, or `false` or `{ ok: false, message }` to refuse it with 403 `verification_failed`. If the hook throws, the request is refused and the error shows up on the Status page, so a provider outage does not let bots in.

The front end sends the captcha token in the `X-Bakorin-Verify` header. The hook gets `action` (`signup` or `create`), `entity`, `token`, `ip`, and the request `headers`. Cloudflare Turnstile looks like this:

```ts title="hooks.ts"
const hooks: BakorinHooks = {
  async verify({ token, ip }) {
    if (!token) return { ok: false, message: "Complete the captcha first." };
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: new URLSearchParams({ secret: process.env.TURNSTILE_SECRET_KEY ?? "", response: token, remoteip: ip }),
    });
    const result = (await res.json()) as { success: boolean };
    return result.success;
  },
};
```

hCaptcha and reCAPTCHA work the same way with their own verify URL. To check only some entities, look at `entity` and return `true` for the rest. Signed in creates skip the hook; use [rate limits](/docs/app-yaml/#rate-limits) for those.

## Custom routes

`routes(app)` receives the Hono app. Add any route you need.

## The change bus

Every successful create, update, and delete emits one event on an in process change bus with `entity`, `op`, `before`, `after`, and `actor`, after the database transaction commits. `after*` hooks subscribe to it. Webhook deliveries, mail rule deliveries, and audit rows do not wait for the bus: they are written inside the same transaction as the record, so they commit or roll back together.

If an `after*` hook throws or its promise rejects, Bakorin logs it with the request id, reports it to error monitoring (Sentry or `ERROR_WEBHOOK_URL` when set, and the Status page), and keeps serving. The write that triggered it has already succeeded. `bakorin start` and `bakorin dev` also catch stray unhandled rejections and exceptions the same way instead of exiting.

In `bakorin dev`, saving `hooks.ts` reloads it along with `app.yaml`: entity hooks and `verify` use the new code on the next request, and CORS origins follow `app.yaml`. New or changed `routes()` need a restart, and the dev server prints a reminder when they change. Modules that `hooks.ts` imports are not reloaded.
