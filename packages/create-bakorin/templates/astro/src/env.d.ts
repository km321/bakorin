/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly BAKORIN_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare namespace App {
  interface Locals {
    /** The signed in user, set by requireAuth in src/middleware.ts. Null when signed out. */
    user: import("./lib/bakorin.gen.ts").Users | null;
  }
}
