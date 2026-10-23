// The build imports its protocol layer from the sibling sealbook-web checkout
// (see the @sealbook/lib alias in vite.config.ts). Absent, Vite fails on the
// first unresolved import with no hint that a second repo is needed.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const required = [
  ["../sealbook-web/src/lib/client.ts", "the protocol layer"],
  ["../sealbook-web/src/pkg/sealbook_wasm.js", "the crypto module (run: npm run wasm)"],
];

const missing = required.filter(([path]) => !existsSync(new URL(path, `file://${root}`)));
if (missing.length > 0) {
  console.error("sealbook-firefox cannot build:");
  for (const [path, what] of missing) {
    console.error(`  missing ${path} (${what})`);
  }
  console.error("\nCheck out sealbook-web beside this repo, then run `npm run wasm`.");
  process.exit(1);
}
