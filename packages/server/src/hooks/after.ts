import type { ChangeEvent } from "@bakorin/core";
import type { ChangeHandler } from "../bus.ts";
import type { BakorinDb } from "../db/dialects.ts";
import type { MailApi } from "../mail/outbox.ts";
import type { BakorinHooks } from "./types.ts";

/**
 * Runs after* hooks once a write has committed. The handler returns the hook's
 * promise so the bus can catch a throw or rejection; a failing hook is logged and
 * reported, and the server keeps serving.
 */
export function subscribeAfterHooks(
  getHooks: () => BakorinHooks,
  db: BakorinDb,
  subscribe: (handler: ChangeHandler) => void,
  mail: MailApi,
): void {
  subscribe(async (event: ChangeEvent) => {
    const entityHooks = getHooks().entities?.[event.entity];
    if (!entityHooks) {
      return;
    }
    const ctx = {
      entity: event.entity,
      record: (event.after ?? event.before ?? {}) as Record<string, unknown>,
      before: event.before,
      actor: event.actor,
      db,
      mail,
    };
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
  });
}
