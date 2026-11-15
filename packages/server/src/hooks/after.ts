import type { ChangeEvent } from "@bakorin/core";
import type { BakorinDb } from "../db/dialects.ts";
import type { MailApi } from "../mail/outbox.ts";
import type { BakorinHooks } from "./types.ts";

export function subscribeAfterHooks(
  hooks: BakorinHooks,
  db: BakorinDb,
  subscribe: (handler: (event: ChangeEvent) => void) => void,
  mail: MailApi,
): void {
  subscribe((event) => {
    const entityHooks = hooks.entities?.[event.entity];
    if (!entityHooks) {
      return;
    }
    const actor = event.actor;
    const ctx = {
      entity: event.entity,
      record: (event.after ?? event.before ?? {}) as Record<string, unknown>,
      before: event.before,
      actor,
      db,
      mail,
    };
    void (async () => {
      switch (event.op) {
        case "create":
          await entityHooks.afterCreate?.(ctx);
          return;
        case "update":
          await entityHooks.afterUpdate?.(ctx);
          return;
        case "delete":
          await entityHooks.afterDelete?.(ctx);
          return;
        default: {
          const exhaustive: never = event.op;
          return exhaustive;
        }
      }
    })();
  });
}
