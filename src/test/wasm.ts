/**
 * Instantiates sealbook-web's wasm module for every suite, before any of them
 * run. Bookmarks are written and read through core, so `@sealbook/lib/bookmark`
 * needs the module up wherever a suite reaches it.
 *
 * The bytes are read off disk because there is no fetch for a file URL here,
 * from a path relative to the working directory because under jsdom
 * `import.meta.url` is an `http:` URL.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import init from "../../../sealbook-web/src/pkg/sealbook_wasm.js";

await init({
  module_or_path: readFileSync(
    resolve(process.cwd(), "../sealbook-web/src/pkg/sealbook_wasm_bg.wasm"),
  ),
});
