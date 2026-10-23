import { loginAccount, normalizeServer, pairJoin, pairReady, type Session } from "@sealbook/lib";
import type { DeviceState } from "@sealbook/lib/types";
import type { PairingStatus } from "../shared/messages";
import { ensureWasm, openSession } from "./session";

/**
 * Pairing, driven from the background page.
 *
 * It cannot live in the popup: approving means looking at the web app, which
 * moves focus, which destroys the popup and with it the joining device's keys.
 * The pairing tab is only a view onto this state.
 *
 * In-memory, deliberately. The joining keys are not yet enrolled and the pairing
 * request expires server-side, so a suspension that loses them costs one restart
 * of a flow the user is sitting in front of, which is better than writing
 * unenrolled secrets anywhere.
 */
let pending: {
  server: string;
  pairCode: string;
  confirm: string;
  state: DeviceState;
  approved: boolean;
  error?: string;
  poll: number;
} | null = null;

const POLL_INTERVAL_MS = 2000;

export function pairingStatus(): PairingStatus {
  if (!pending) return { phase: "idle" };
  const shown = { pairCode: pending.pairCode, confirm: pending.confirm };
  if (pending.error) return { phase: "failed", error: pending.error, ...shown };
  return { phase: pending.approved ? "approved" : "waiting", ...shown };
}

export function cancelPairing(): void {
  if (!pending) return;
  clearInterval(pending.poll);
  pending = null;
}

export async function beginPairing(server: string, username: string): Promise<PairingStatus> {
  await ensureWasm();
  cancelPairing();
  const normalized = normalizeServer(server);
  const joined = await pairJoin(normalized, username.trim());
  pending = {
    server: normalized,
    pairCode: joined.pairCode,
    confirm: joined.confirm,
    state: joined.state,
    approved: false,
    poll: 0,
  };
  const target = pending;
  target.poll = setInterval(() => {
    void poll(target);
  }, POLL_INTERVAL_MS) as unknown as number;
  void poll(target);
  return pairingStatus();
}

async function poll(target: NonNullable<typeof pending>): Promise<void> {
  if (pending !== target || target.approved) return;
  try {
    if (await pairReady(target.server, target.pairCode)) {
      target.approved = true;
      clearInterval(target.poll);
    }
  } catch (err) {
    const message = (err instanceof Error ? err.message : String(err)).toLowerCase();
    if (message.includes("expired") || message.includes("not found")) {
      target.error = "That pairing request expired. Start again.";
      clearInterval(target.poll);
    }
    // Anything else is treated as transient; keep polling.
  }
}

/**
 * Finishes pairing with the account password.
 *
 * `loginAccount` runs `syncRoster` itself, so the roster verification and the
 * rollback pin come with it rather than needing a step here.
 */
export async function completePairing(password: string): Promise<void> {
  if (!pending) throw new Error("There is no pairing in progress.");
  if (!pending.approved) throw new Error("Approve this device in the Sealbook web app first.");
  const session: Session = await loginAccount(pending.state, password);
  await openSession(session, password);
  cancelPairing();
}
