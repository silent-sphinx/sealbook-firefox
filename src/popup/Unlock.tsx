import { useState, type FormEvent } from "react";
import { send } from "./rpc";

/**
 * The password screen, shown when a paired extension has no unlocked session.
 *
 * One entry per browser session: the token's 24-hour TTL is answered by a silent
 * re-login in the background, so only a restart or the idle lock lands here.
 */
export function Unlock({ account, onUnlocked }: {
  account?: { server: string; username: string };
  onUnlocked: () => void;
}) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const response = await send({ kind: "unlock", password });
    setBusy(false);
    if (!response.ok) {
      setError(response.error);
      return;
    }
    setPassword("");
    onUnlocked();
  }

  return (
    <form onSubmit={onSubmit}>
      <h1>Unlock Sealbook</h1>
      {account ? (
        <p className="host">
          {account.username} at {account.server}
        </p>
      ) : null}
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
        {busy ? "Unlocking…" : "Unlock"}
      </button>
      {error ? <p className="error">{error}</p> : null}
    </form>
  );
}
