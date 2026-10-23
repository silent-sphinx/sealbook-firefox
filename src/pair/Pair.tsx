import { useEffect, useState, type FormEvent } from "react";
import type { PairingStatus } from "../shared/messages";
import { ensureHostPermission } from "../shared/permissions";
import { send } from "../popup/rpc";
import { describeError } from "@sealbook/lib/log";
import { confirmationGroups } from "@sealbook/lib/pairing";

/**
 * Pairing, as a full extension tab.
 *
 * The poll for approval runs in the background page; this view asks it for the
 * phase every couple of seconds. That is what lets the user switch to the web
 * app to approve without losing the joining device's keys.
 */
const POLL_INTERVAL_MS = 2000;

export function Pair() {
  const [server, setServer] = useState("https://127.0.0.1:8443");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [pairing, setPairing] = useState<PairingStatus>({ phase: "idle" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (pairing.phase !== "waiting" || done) return;
    const id = window.setInterval(() => {
      void (async () => {
        const response = await send({ kind: "pairingStatus" });
        if (response.ok && response.kind === "pairing") setPairing(response.pairing);
      })();
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [pairing.phase, done]);

  async function onJoin(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    // Not awaited behind anything: the permission prompt needs the click.
    let granted: boolean;
    try {
      granted = await ensureHostPermission(server);
    } catch (err) {
      setBusy(false);
      setError(`That server address was refused: ${describeError(err)}`);
      return;
    }
    if (!granted) {
      setBusy(false);
      setError("Sealbook needs permission to reach that server.");
      return;
    }
    const response = await send({ kind: "beginPairing", server, username });
    setBusy(false);
    if (!response.ok) {
      setError(response.error);
      return;
    }
    if (response.kind === "pairing") setPairing(response.pairing);
  }

  async function onFinish(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const response = await send({ kind: "completePairing", password });
    setBusy(false);
    setPassword("");
    if (!response.ok) {
      setError(response.error);
      return;
    }
    setDone(true);
  }

  if (done) {
    return (
      <div>
        <h1>Paired</h1>
        <p className="note">
          This extension is now a device on your account. Close this tab and use
          the toolbar button to save a page.
        </p>
      </div>
    );
  }

  if (pairing.phase === "idle") {
    return (
      <form onSubmit={onJoin}>
        <h1>Pair this extension</h1>
        <label>
          Server
          <input value={server} onChange={(event) => setServer(event.target.value)} />
        </label>
        <label>
          Username
          <input
            value={username}
            autoComplete="username"
            onChange={(event) => setUsername(event.target.value)}
          />
        </label>
        <button type="submit" disabled={busy || !username.trim()}>
          {busy ? "Starting…" : "Start pairing"}
        </button>
        {error ? <p className="error">{error}</p> : null}
      </form>
    );
  }

  return (
    <div>
      <h1>Approve this device</h1>
      <p className="note">
        On your signed-in device, open Sealbook, click Add device, and type these
        eight words.
      </p>
      <div className="words">
        {(pairing.pairCode ?? "").split(" ").filter(Boolean).map((word, index) => (
          <span key={`${index}-${word}`}>{word}</span>
        ))}
      </div>
      <button
        type="button"
        className="secondary"
        onClick={() => {
          void navigator.clipboard.writeText(pairing.pairCode ?? "");
          setCopied(true);
          window.setTimeout(() => setCopied(false), 2000);
        }}
      >
        {copied ? "Copied" : "Copy code"}
      </button>
      <p className="note">
        Then check that both devices show this same confirmation code. Compare it
        digit for digit: that comparison is what authenticates the two devices to
        each other.
      </p>
      {/* Grouped as the web app and the CLI group it: the two codes are only
          comparable by eye at the same spacing. */}
      <code className="confirm">
        {confirmationGroups(pairing.confirm ?? "").map((group, index) => (
          <span key={`${index}-${group}`}>{group}</span>
        ))}
      </code>
      {pairing.phase === "failed" ? (
        <>
          <p className="error">{pairing.error}</p>
          <button
            type="button"
            className="secondary"
            onClick={() => {
              void send({ kind: "cancelPairing" });
              setPairing({ phase: "idle" });
            }}
          >
            Start again
          </button>
        </>
      ) : pairing.phase === "approved" ? (
        <form onSubmit={onFinish}>
          <p className="note">Approved. Enter your account password to finish.</p>
          <label>
            Password
            <input
              type="password"
              value={password}
              autoFocus
              autoComplete="current-password"
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <button type="submit" disabled={busy || !password}>
            {busy ? "Signing in…" : "Finish pairing"}
          </button>
          {error ? <p className="error">{error}</p> : null}
        </form>
      ) : (
        <p className="note">Waiting for approval…</p>
      )}
    </div>
  );
}
