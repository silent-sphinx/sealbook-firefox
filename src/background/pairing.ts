import {
  browserOs,
  loginAccount,
  normalizeServer,
  pairJoin,
  pairJoinStep,
  type JoinPairing,
  type Session,
} from "@sealbook/lib";
import { friendlyError } from "@sealbook/lib/errors";
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
 * In-memory, deliberately. The joining keys are not yet enrolled, the secret
 * half of the pairing's CPace run must never be written anywhere, and the
 * request expires server-side, so a suspension that loses them costs one restart
 * of a flow the user is sitting in front of.
 */
let pending: {
  pairing: JoinPairing;
  /** Set once approved: the device state with the roster pin the approval sealed. */
  state?: DeviceState;
  approved: boolean;
  error?: string;
  poll: number;
} | null = null;

export function pairingStatus(): PairingStatus {
  if (!pending) return { phase: "idle" };
  const shown = { pairCode: pending.pairing.code, qrText: pending.pairing.qrText };
  if (pending.error) return { phase: "failed", error: pending.error, ...shown };
  return { phase: pending.approved ? "approved" : "waiting", ...shown };
}

export function cancelPairing(): void {
  if (!pending) return;
  clearTimeout(pending.poll);
  pending = null;
}

export async function beginPairing(server: string, username: string): Promise<PairingStatus> {
  await ensureWasm();
  cancelPairing();
  const normalized = normalizeServer(server);
  const joined = await pairJoin(normalized, username.trim());
  pending = { pairing: joined, approved: false, poll: 0 };
  const target = pending;
  void poll(target);
  return pairingStatus();
}

async function poll(target: NonNullable<typeof pending>): Promise<void> {
  if (pending !== target || target.approved) return;
  try {
    const next = await pairJoinStep(target.pairing, `Firefox extension on ${browserOs()}`);
    if (pending !== target) return;
    if (next.kind === "ready") {
      target.state = next.state;
      target.approved = true;
    } else if (next.kind === "expired") {
      target.error = "That pairing request expired or was turned down. Start again.";
    } else {
      target.poll = setTimeout(() => {
        void poll(target);
      }, next.afterMs) as unknown as number;
    }
  } catch (err) {
    // Only core refuses here, and a refusal ends the pairing: the approving
    // device's answer did not verify.
    if (pending === target) target.error = friendlyError(err);
  }
}

/**
 * Finishes pairing with the account password.
 *
 * `loginAccount` runs `adoptKey` itself, so the roster verification, the check
 * of the served key against it, and the rollback pin come with it rather than
 * needing a step here.
 */
export async function completePairing(password: string): Promise<void> {
  if (!pending) throw new Error("There is no pairing in progress.");
  if (!pending.approved || !pending.state) {
    throw new Error("Approve this device in the Sealbook web app first.");
  }
  const session: Session = await loginAccount(pending.state, password);
  await openSession(session, password);
  cancelPairing();
}
