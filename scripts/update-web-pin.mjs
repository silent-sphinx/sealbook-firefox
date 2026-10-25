// Moves sealbook-web.pin to the sibling checkout's current commit. Commit the
// new pin together with whatever change needed it.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const web = fileURLToPath(new URL("../../sealbook-web/", import.meta.url));
const actual = execFileSync("git", ["-C", web, "rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();

writeFileSync(
  new URL("../sealbook-web.pin", import.meta.url),
  [
    "# The sealbook-web commit this repo builds its protocol layer from.",
    "# Checked by scripts/preflight.mjs; moved by scripts/update-web-pin.mjs.",
    actual,
    "",
  ].join("\n"),
);

console.log(`pinned sealbook-web at ${actual}`);
const dirty = execFileSync("git", ["-C", web, "status", "--porcelain"], {
  encoding: "utf8",
}).trim();
if (dirty) {
  console.error("warning: sealbook-web has uncommitted changes, so this pin does not describe them");
}
