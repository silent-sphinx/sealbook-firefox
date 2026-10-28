import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const lib = fileURLToPath(new URL("../sealbook-web/src/lib", import.meta.url));

export default defineConfig({
  // Mirrors the define sealbook-web sets: `@sealbook/lib/log` reads it.
  define: {
    __APP_VERSION__: JSON.stringify("test"),
  },
  resolve: {
    alias: [
      { find: /^@sealbook\/lib$/u, replacement: `${lib}/client.ts` },
      { find: /^@sealbook\/lib\//u, replacement: `${lib}/` },
    ],
  },
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["src/test/wasm.ts"],
    // No global `environment`: the logic suites run under node, and the
    // component suites opt into jsdom with a `@vitest-environment` docblock.
    // Nothing in @sealbook/lib is retested here; that is sealbook-web's job,
    // and duplicating it is how the two drift.

    // Several of these derive a 600,000-iteration PBKDF2 key with the real
    // crypto.subtle, which is the part worth testing and is not fast.
    testTimeout: 20_000,
  },
});
