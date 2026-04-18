/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Optional full API origin (no trailing slash). When unset, use same-origin `/api` + Vite proxy. */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
