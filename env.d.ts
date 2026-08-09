/// <reference types="vite/client" />

interface ImportMetaHotContext {
  dispose(callback: () => void): void;
}

interface ImportMeta {
  readonly hot?: ImportMetaHotContext;
}
