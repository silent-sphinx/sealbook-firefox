import { useState } from "react";
import type { Request } from "../shared/messages";
import { send } from "./rpc";

/**
 * The account line and the two controls that leave this device.
 *
 * Signing out confirms in place rather than in a dialog: the popup is destroyed
 * the moment it loses focus, so a modal here has nowhere to live.
 */
export function AccountFooter({
  account,
  canLock,
  onChanged,
}: {
  account?: { server: string; username: string };
  canLock: boolean;
  onChanged: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function act(request: Request) {
    setBusy(true);
    setError(null);
    const response = await send(request);
    setBusy(false);
    if (!response.ok) {
      setError(response.error);
      return;
    }
    onChanged();
  }

  if (confirming) {
    return (
      <div className="footer">
        <p className="note">
          Signing out removes this extension's keys from this browser. Nothing is
          deleted from your account, and this device stays on your roster until
          you revoke it in the Sealbook web app.
        </p>
        <div className="row">
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() => void act({ kind: "unpair" })}
          >
            {busy ? "Signing out…" : "Sign out"}
          </button>
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() => setConfirming(false)}
          >
            Cancel
          </button>
        </div>
        {error ? <p className="error">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="footer">
      {account ? (
        <p className="host">
          {account.username} at {account.server}
        </p>
      ) : null}
      <div className="row">
        {canLock ? (
          <button
            type="button"
            className="secondary"
            disabled={busy}
            // Drops the keys, not the enrolment: the next open asks for the
            // password, as it does after the idle lock.
            onClick={() => void act({ kind: "lock" })}
          >
            {busy ? "Locking…" : "Lock"}
          </button>
        ) : null}
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={() => setConfirming(true)}
        >
          Sign out…
        </button>
      </div>
      {error ? <p className="error">{error}</p> : null}
    </div>
  );
}
