/** @jsxImportSource react */
import { type ReactNode } from "react";
import type { BakorinClient } from "../index.ts";
import { type AuthController } from "../headless/auth.ts";
import type { AppSchema } from "../headless/schema.ts";
export interface BakorinContextValue {
    client: BakorinClient;
    auth: AuthController;
    schema?: AppSchema;
    basePath: string;
}
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
export declare function BakorinProvider({ children, basePath, client, initialUser, schema }: BakorinProviderProps): import("react").JSX.Element;
export declare function useBakorin(): BakorinContextValue;
