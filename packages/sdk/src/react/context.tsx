/** @jsxImportSource react */
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { createBrowserClient } from "../browser.ts";
import type { BakorinClient } from "../index.ts";
import { createAuth, type AuthController } from "../headless/auth.ts";
import type { AppSchema } from "../headless/schema.ts";

export interface BakorinContextValue {
  client: BakorinClient;
  auth: AuthController;
  schema?: AppSchema;
  basePath: string;
}

const BakorinContext = createContext<BakorinContextValue | null>(null);

export interface BakorinProviderProps {
  children?: ReactNode;
  /** Your pass through route. Default /api/bakorin. */
  basePath?: string;
  /** A client to use instead of createBrowserClient (tests, custom fetch). */
  client?: BakorinClient;
  /** The user your server component loaded, or null when signed out. Leave out to load it in the browser. */
  initialUser?: object | null;
  /** bakorinSchema from bakorin.gen.ts, for RecordForm, DataTable, and SignUpForm. */
  schema?: AppSchema;
}

/** Shares one browser client, the auth state, and the schema with every component below. */
export function BakorinProvider({ children, basePath = "/api/bakorin", client, initialUser, schema }: BakorinProviderProps) {
  const value = useMemo<BakorinContextValue>(() => {
    const resolved = client ?? (createBrowserClient({ basePath }) as BakorinClient);
    return { client: resolved, auth: createAuth(resolved, { initialUser: initialUser as Record<string, unknown> | null | undefined }), schema, basePath };
    // initialUser only seeds the store; later changes come from the auth actions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, basePath, schema]);
  return <BakorinContext.Provider value={value}>{children}</BakorinContext.Provider>;
}

export function useBakorin(): BakorinContextValue {
  const value = useContext(BakorinContext);
  if (!value) {
    throw new Error("Bakorin components need a <BakorinProvider> above them.");
  }
  return value;
}
