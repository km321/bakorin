import type { SchemaAST } from "@bakorin/core";
import type { ChangeBus } from "./bus.ts";
import type { BakorinDb } from "./db/dialects.ts";
import type { BakorinHooks } from "./hooks/types.ts";
import type { FileStore } from "./files/store.ts";

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
}

declare module "hono" {
  interface ContextVariableMap {
    actor: Actor | null;
    app: AppContext;
  }
}
