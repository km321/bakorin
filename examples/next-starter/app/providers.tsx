"use client";

import type { ReactNode } from "react";
import { BakorinProvider } from "@bakorin/sdk/react";
import { bakorinSchema as schema, type Users as User } from "../lib/bakorin.gen.ts";

/** Shares the browser client (through /api/bakorin), the signed in user, and the schema with the components. */
export function Providers({ user, children }: { user: User | null; children: ReactNode }) {
  return (
    <BakorinProvider initialUser={user} schema={schema}>
      {children}
    </BakorinProvider>
  );
}
