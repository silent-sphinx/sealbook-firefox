import { useCallback, useEffect, useState } from "react";
import type { Lookup, Status } from "../shared/messages";
import { AccountFooter } from "./AccountFooter";
import { EditForm } from "./EditForm";
import { Unlock } from "./Unlock";
import { send } from "./rpc";
import { activePage, type PageRef } from "./tab";

type Phase =
  | { at: "loading" }
  | { at: "unpaired" }
  | { at: "locked" }
  | { at: "unsupported" }
  | { at: "error"; message: string }
  | { at: "ready"; lookup: Lookup; page: PageRef }
  | { at: "saved" };

/** What a reply of the wrong shape is reported as, rather than a stuck spinner. */
const UNEXPECTED = "The background page answered something this popup cannot read.";

export function Popup() {
  const [phase, setPhase] = useState<Phase>({ at: "loading" });
  const [account, setAccount] = useState<Status["account"]>();

  // Does not reset to "loading" itself: the initial state already is, and a
  // synchronous setState in the mount effect is a cascading render. The callers
  // that re-run it are event handlers and set it themselves.
  const load = useCallback(async () => {
    // The tab read is started alongside the status request rather than after it,
    // so the form has its page as soon as the background answers.
    const [statusResponse, page] = await Promise.all([send({ kind: "status" }), activePage()]);
    if (!statusResponse.ok) {
      setPhase({ at: "error", message: statusResponse.error });
      return;
    }
    if (statusResponse.kind !== "status") {
      setPhase({ at: "error", message: UNEXPECTED });
      return;
    }
    setAccount(statusResponse.status.account);
    if (statusResponse.status.lockState === "unpaired") {
      setPhase({ at: "unpaired" });
      return;
    }
    if (statusResponse.status.lockState === "locked") {
      setPhase({ at: "locked" });
      return;
    }
    if (!page) {
      setPhase({ at: "unsupported" });
      return;
    }
    const lookupResponse = await send({ kind: "lookup", url: page.url });
    if (!lookupResponse.ok) {
      setPhase({ at: "error", message: lookupResponse.error });
      return;
    }
    if (lookupResponse.kind !== "lookup") {
      setPhase({ at: "error", message: UNEXPECTED });
      return;
    }
    setPhase({ at: "ready", lookup: lookupResponse.lookup, page });
  }, []);

  // The external system this effect synchronizes with is the background page:
  // the popup has no state of its own to derive this from, and the ask cannot
  // happen during render. Every setState inside `load` is behind an await.
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect
    void load();
  }, [load]);

  const reload = useCallback(() => {
    setPhase({ at: "loading" });
    void load();
  }, [load]);

  switch (phase.at) {
    case "loading":
      return <p className="note">Loading…</p>;
    case "unpaired":
      return (
        <div>
          <h1>Connect to Sealbook</h1>
          <p className="note">
            This extension pairs as its own device, so it can be revoked without
            touching the others.
          </p>
          <button
            type="button"
            onClick={() => {
              // A full tab, not this popup: approving means looking at the web
              // app, and the popup is destroyed the moment it loses focus.
              void send({ kind: "openPairingTab" });
            }}
          >
            Pair this extension
          </button>
        </div>
      );
    case "locked":
      return (
        <>
          <Unlock account={account} onUnlocked={reload} />
          {/* No Lock here, and a way out for a password that is not coming back. */}
          <AccountFooter canLock={false} onChanged={reload} />
        </>
      );
    case "unsupported":
      return (
        <>
          <p className="note">This page has no address Sealbook can save.</p>
          <AccountFooter account={account} canLock onChanged={reload} />
        </>
      );
    case "error":
      return (
        <div>
          <p className="error">{phase.message}</p>
          <button type="button" className="secondary" onClick={reload}>
            Try again
          </button>
        </div>
      );
    case "saved":
      return (
        <div>
          <p className="note">Saved to Sealbook.</p>
          <div className="row">
            <button type="button" className="secondary" onClick={reload}>
              Edit it
            </button>
            <button type="button" className="secondary" onClick={() => window.close()}>
              Close
            </button>
          </div>
        </div>
      );
    case "ready": {
      if (!phase.lookup.bookmarksEnabled) {
        return (
          <>
            <p className="note">
              Bookmarks are turned off for this account. Enable them in the
              Sealbook web app, or this extension would write rows it hides.
            </p>
            <AccountFooter account={account} canLock onChanged={reload} />
          </>
        );
      }
      const existing = phase.lookup.existing;
      return (
        <>
          <EditForm
            draft={
              existing?.draft ?? {
                url: phase.page.url,
                title: phase.page.title,
                collectionId: phase.lookup.defaultCollectionId,
                tags: [],
              }
            }
            collections={phase.lookup.collections}
            existingId={existing?.id}
            onSaved={() => setPhase({ at: "saved" })}
          />
          <AccountFooter account={account} canLock onChanged={reload} />
        </>
      );
    }
  }
}
