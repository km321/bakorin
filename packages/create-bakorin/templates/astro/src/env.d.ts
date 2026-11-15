/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly BAKORIN_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
