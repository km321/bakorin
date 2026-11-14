import { createHmac } from "node:crypto";
import type { ChangeEvent, SchemaAST } from "@bakorin/core";

async function postOnce(url: string, body: string, headers: Record<string, string>): Promise<boolean> {
  try {
    const response = await fetch(url, { method: "POST", headers, body });
    return response.ok;
  } catch {
    return false;
  }
}

export function subscribeWebhooks(ast: SchemaAST, subscribe: (handler: (event: ChangeEvent) => void) => void): void {
  if (ast.webhooks.length === 0) {
    return;
  }
  subscribe((event) => {
    void (async () => {
      for (const hook of ast.webhooks) {
        if (hook.entity !== "*" && hook.entity !== event.entity) {
          continue;
        }
        if (!hook.events.includes(event.op)) {
          continue;
        }
        const payload = JSON.stringify({
          event: `${event.entity}.${event.op}`,
          entity: event.entity,
          op: event.op,
          before: event.before,
          after: event.after,
          actor: event.actor,
        });
        const headers: Record<string, string> = {
          "content-type": "application/json",
          "x-bakorin-event": `${event.entity}.${event.op}`,
        };
        if (hook.secret) {
          const signature = createHmac("sha256", hook.secret).update(payload).digest("hex");
          headers["x-bakorin-signature"] = `sha256=${signature}`;
        }
        for (let attempt = 0; attempt < 3; attempt += 1) {
          const ok = await postOnce(hook.url, payload, headers);
          if (ok) {
            break;
          }
          await Bun.sleep(100 * 2 ** attempt);
        }
      }
    })();
  });
}
