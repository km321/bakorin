import type { SchemaAST } from "@bakorin/core";
import type { ChangeBus } from "./bus.ts";
import type { BakorinDb } from "./db/dialects.ts";
import type { BakorinHooks } from "./hooks/types.ts";
import type { FileStore } from "./files/store.ts";
import type { Mailer } from "./mail/types.ts";
import type { MailApi } from "./mail/outbox.ts";
import type { Monitor } from "./monitor/monitor.ts";
import type { RealtimeHub } from "./realtime/hub.ts";

export interface Actor {
  id: string;
  role: string;
}

export interface AppContext {
  ast: SchemaAST;
  db: BakorinDb;
  bus: ChangeBus;
  hooks: BakorinHooks;
  files: FileStore;
  projectDir: string;
  mailer: Mailer;
  /** Queue an email through the mail outbox (same as ctx.mail in hooks). */
  mail: MailApi;
  /** Request logs, recent errors and counters for /metrics and the Status page. */
  monitor: Monitor;
  /** BAKORIN_MCP_TOKEN: a long lived admin token for the read only MCP server. */
  mcpToken?: string;
  /** BAKORIN_PROXY_SECRET: a site pass through route that sends it may name the visitor IP. */
  proxySecret?: string;
  /** Server sent events for entities with realtime: on. Always present; idle until used. */
  realtime?: RealtimeHub;
  /** Production: /auth/first-admin needs the setup token printed to the log at boot. */
  requireSetupToken?: boolean;
}

declare module "hono" {
  interface ContextVariableMap {
    actor: Actor | null;
    app: AppContext;
  }
}
