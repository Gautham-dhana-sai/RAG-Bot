/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_DEFAULT_TENANT_ID?: string;
  readonly VITE_DEFAULT_ENTITY_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

