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

// The pinned sealbook-web commit. This repo imports its whole protocol layer
// from that checkout through the `@sealbook/lib` alias, so which commit it was
// built against is part of the build. The sealbook pin underneath it is checked
// by `sealbook-web/scripts/check-sealbook-pin.sh`, which `npm run wasm` runs.
//
// Move it with: node scripts/update-web-pin.mjs
// Build against another commit once with: ALLOW_UNPINNED_WEB=1
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const pinFile = new URL("../sealbook-web.pin", import.meta.url);
const web = fileURLToPath(new URL("../sealbook-web", `file://${root}`));

let pinned;
try {
  pinned = readFileSync(pinFile, "utf8")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("")
    .trim();
} catch {
  console.error(`sealbook-firefox cannot build: missing ${fileURLToPath(pinFile)}`);
  process.exit(1);
}

const actual = execFileSync("git", ["-C", web, "rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();

if (pinned !== actual) {
  console.error("sealbook-web checkout does not match the pin:");
  console.error(`  pinned: ${pinned}`);
  console.error(`  actual: ${actual}`);
  console.error("Check out the pinned commit, or run `node scripts/update-web-pin.mjs`.");
  if (process.env.ALLOW_UNPINNED_WEB === "1") {
    console.error("ALLOW_UNPINNED_WEB=1: continuing anyway.");
  } else {
    process.exit(1);
  }
}

// Local edits are normal while developing, and the pin still names the commit
// they sit on top of, so this is a warning rather than a failure.
const dirty = execFileSync("git", ["-C", web, "status", "--porcelain"], {
  encoding: "utf8",
}).trim();
if (dirty) {
  console.error(
    "note: sealbook-web has uncommitted changes; this build is not reproducible from the pin alone",
  );
}
