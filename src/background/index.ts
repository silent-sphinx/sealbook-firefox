import { isRequest, type Response } from "../shared/messages";
import { lock } from "../shared/extStorage";
import { ext } from "../shared/runtime";
import { handle } from "./handlers";
import { dropSession } from "./session";

/**
 * The event page.
 *
 * It is allowed to suspend: nothing is held open with an alarm, because the
 * unlocked material lives in `storage.session` and `session.ts` rebuilds the
 * `Session` on the next wake. `logStartup()` from the shared log module is never
 * called: it reaches for `window` through `capabilities()`, which is the one
 * thing in that module an extension page cannot promise.
 */

/** Matches the web app's idle lock, which drops the keys rather than the token. */
const IDLE_SECONDS = 15 * 60;

ext().runtime.onMessage.addListener((message) => {
  if (!isRequest(message)) {
    const refused: Response = { ok: false, error: "Malformed request." };
    return Promise.resolve(refused);
  }
  // Returned as a promise, not answered through `respond`: Firefox keeps the
  // page alive while a message reply is outstanding, which is what makes a
  // write safe across a suspension.
  return handle(message).catch((err: unknown) => {
    const failed: Response = {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
    return failed;
  });
});

ext().idle.setDetectionInterval(IDLE_SECONDS);
ext().idle.onStateChanged.addListener((state) => {
  if (state !== "active") {
    dropSession();
    void lock();
  }
});

ext().runtime.onInstalled.addListener(() => {
  // A fresh install or an update leaves no unlocked state behind: the session
  // area is memory-backed and the in-memory session belongs to the old page.
  dropSession();
  void lock();
});
