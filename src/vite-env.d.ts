/// <reference types="vite/client" />

/**
 * The package version, injected at build time by `vite.config.ts`.
 *
 * Declared here because the imported `@sealbook/lib/log` reads it, and the
 * aliased files are checked under this repo's flags.
 */
declare const __APP_VERSION__: string;
