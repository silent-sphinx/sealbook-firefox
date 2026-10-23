# Sealbook for Firefox

One toolbar click saves the page you are on as a sealed bookmark in your
Sealbook vault: a short form for the title, collection, tags and a note, and the
write goes out as an encrypted object under a dual-signed manifest, exactly as
the web client's does.

The extension is not a thin client. Every vault write is an
XChaCha20-Poly1305 envelope sealed under the account's collection key, carrying
an ML-DSA-65 + Ed25519 manifest that commits to every object in the collection.
So this extension pairs as **its own device**, with its own key material, and can
be revoked in the web app without touching your other devices.

## What it needs beside it

This repo holds the extension only. Two sibling checkouts have to sit next to it,
with these exact directory names:

```text
sealbook/          the server, and the crate the WASM crypto module is built from
sealbook-web/      the protocol layer, imported here as @sealbook/lib
sealbook-firefox/  this repo
```

The protocol layer is imported across repos through a Vite alias rather than
vendored, so the two clients cannot drift. `npm run preflight` (which `build` and
`dev` run first) fails with a readable message if either sibling is missing.

## Build

```bash
npm install
npm run wasm     # builds sealbook-web/src/pkg from the sealbook crate
npm run build    # dist/
```

Before opening a pull request, run what CI runs:

```bash
npm run lint
npx tsc -b
npm test
```

## Load it in Firefox

1. Visit `about:debugging#/runtime/this-firefox`.
2. **Load Temporary Add-on**, and pick `dist/manifest.json`.
3. **Inspect** opens the background page's console, which is where a stale
   crypto module or an unreachable server will say so.

Firefox has no MV3 service worker, so the background is an event page: a real
document, with `window` and `localStorage`. The manifest declares both
`background.scripts` (for Firefox) and `background.service_worker` (for a later
Chrome build), which needs `strict_min_version: "121.0"`. Before 121 the
background page refused to start when `service_worker` was also present.

### The self-signed development certificate

A background `fetch` has no tab, so Firefox cannot show the certificate
interstitial: the request simply rejects, and the shared transport reports
*"The server could not be reached."* with no hint that TLS was the cause.

Before anything else, in the profile you are loading the extension into, open
`https://127.0.0.1:8443/health` in a tab and add a permanent exception (or import
the development `cert.pem` as a trusted authority). Otherwise the first run looks
exactly like a server that is not running.

## Pair it

1. Click the toolbar button, then **Pair this extension**. Pairing opens a full
   tab, not the popup: approving means looking at the web app, and a popup is
   destroyed the moment it loses focus.
2. Enter your server and username. Firefox asks for permission to reach that
   host, because a self-hosted server's address is not known at build time, so
   it is requested here rather than baked into the manifest.
3. In the Sealbook web app, go to Settings and then Add Device, and compare the
   confirmation code **digit for digit**. That comparison is what authenticates
   the two devices to each other; a code that is merely "about right" proves
   nothing.
4. Approve, then enter your account password to finish.

## Licence

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE), and
[CONTRIBUTING.md](CONTRIBUTING.md) for the sign-off every commit needs.
