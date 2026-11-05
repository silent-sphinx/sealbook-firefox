import { ensureDefaultBookmarkCollection, loginAccount } from "@sealbook/lib";
import { normalizeUrl } from "@sealbook/lib/bookmark";
import type { BookmarkDraft } from "@sealbook/lib/types";
import type { Request, Response, Status } from "../shared/messages";
import {
  forgetDevice,
  hasBootstrapped,
  loadDevice,
  loadDeviceMetadata,
  lock,
  markBootstrapped,
} from "../shared/extStorage";
import { ext } from "../shared/runtime";
import {
  defaultCollectionId,
  readCache,
  recordCollections,
  type Cache,
} from "./collections";
import { beginPairing, cancelPairing, completePairing, pairingStatus } from "./pairing";
import { draftFromEntry, saveBookmark } from "./save";
import {
  currentPassword,
  dropSession,
  ensureWasm,
  hasUnlocked,
  LockedError,
  openSession,
  withSession,
} from "./session";

/**
 * The message union, resolved to functions.
 *
 * Every protocol call sits inside one of these handlers, and `onMessage` awaits
 * the reply. Firefox will not suspend an event page with a pending message
 * response, so this is what keeps a `putSealed` from being cut off between the
 * PUT and the `saveDevice` that persists `manifest_seq`. A fire-and-forget
 * handler would lose exactly that.
 */
export async function handle(request: Request): Promise<Response> {
  switch (request.kind) {
    case "status":
      return { ok: true, kind: "status", status: await status() };
    case "unlock":
      return unlock(request.password);
    case "lock":
      dropSession();
      await lock();
      return { ok: true, kind: "done" };
    case "unpair":
      // Local only: the device stays on the account's roster, which is revoked
      // from the web app. Nothing here can revoke it, because doing so is a
      // signed roster write and this device's keys are what is being discarded.
      dropSession();
      cancelPairing();
      await forgetDevice();
      return { ok: true, kind: "done" };
    case "beginPairing":
      return {
        ok: true,
        kind: "pairing",
        pairing: await beginPairing(request.server, request.username),
      };
    case "pairingStatus":
      return { ok: true, kind: "pairing", pairing: pairingStatus() };
    case "completePairing":
      await completePairing(request.password);
      return { ok: true, kind: "status", status: await status() };
    case "cancelPairing":
      cancelPairing();
      return { ok: true, kind: "done" };
    case "openPairingTab":
      await ext().tabs.create({ url: ext().runtime.getURL("pair.html") });
      return { ok: true, kind: "done" };
    case "lookup":
      return lookup(request.url);
    case "save":
      return save(request.draft, request.existingId);
  }
}

async function status(): Promise<Status> {
  const metadata = await loadDeviceMetadata();
  if (!metadata) return { lockState: "unpaired" };
  const account = { server: metadata.server, username: metadata.username };
  if (!(await hasUnlocked())) return { lockState: "locked", account };
  return { lockState: "unlocked", account };
}

async function unlock(password: string): Promise<Response> {
  const state = await loadDevice(password);
  if (!state) {
    return { ok: false, error: "That password did not open this device's keys." };
  }
  // Before the login, which signs its challenge with the bundled module: a stale
  // build should fail as itself here rather than part way through OPAQUE.
  await ensureWasm();
  // The stored envelope holds no token, so unlocking is a login. It also runs
  // `syncRoster`, which is where the roster check and the rollback pin happen.
  await openSession(await loginAccount(state, password), password);
  return { ok: true, kind: "status", status: await status() };
}

/**
 * The cache the popup paints from, bootstrapping the default collection the
 * first time only.
 */
async function warmCache(password: string): Promise<Cache> {
  // Inside `withSession` because the freshness check is an authenticated GET,
  // so this is the first place a day-old token shows up as a 401.
  return withSession(async (session) => {
    const { cache, listed } = await readCache(session, password);
    if (!listed || (await hasBootstrapped())) return cache;
    const collections = await ensureDefaultBookmarkCollection(session, cache.collections);
    await markBootstrapped();
    return recordCollections(password, cache, collections);
  });
}

async function lookup(url: string): Promise<Response> {
  const password = await currentPassword();
  if (password === null) throw new LockedError();
  const cache = await warmCache(password);
  const entry = cache.urlIndex[normalizeUrl(url)];
  return {
    ok: true,
    kind: "lookup",
    lookup: {
      collections: cache.collections,
      defaultCollectionId: defaultCollectionId(cache),
      bookmarksEnabled: cache.bookmarksEnabled,
      deviceName: cache.deviceName || undefined,
      existing: entry ? { id: entry.id, draft: draftFromEntry(entry, url) } : undefined,
    },
  };
}

async function save(draft: BookmarkDraft, existingId?: string): Promise<Response> {
  const password = await currentPassword();
  if (password === null) throw new LockedError();
  const cache = await warmCache(password);
  const { id } = await withSession((session) =>
    saveBookmark(session, password, cache, draft, existingId),
  );
  return { ok: true, kind: "save", id };
}
