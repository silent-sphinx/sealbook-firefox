import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const lib = fileURLToPath(new URL("../sealbook-web/src/lib", import.meta.url));

const { version } = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
) as { version: string };

export default defineConfig({
  // Mirrors the define sealbook-web sets: `@sealbook/lib/log` reads it.
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  resolve: {
    alias: [
      // The protocol layer is imported from the sibling checkout rather than
      // vendored, so the two clients cannot drift. The barrel entry is matched
      // before the directory one, which would otherwise swallow it.
      { find: /^@sealbook\/lib$/u, replacement: `${lib}/client.ts` },
      { find: /^@sealbook\/lib\//u, replacement: `${lib}/` },
    ],
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // An extension is loaded as files, not served: no hashed names, and no
    // inlined assets, because the .wasm must stay a fetchable file.
    assetsInlineLimit: 0,
    target: "firefox121",
    rollupOptions: {
      input: {
        background: fileURLToPath(new URL("src/background/index.ts", import.meta.url)),
        popup: fileURLToPath(new URL("popup.html", import.meta.url)),
        pair: fileURLToPath(new URL("pair.html", import.meta.url)),
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: "assets/[name][extname]",
      },
    },
  },
  plugins: [react()],
});
