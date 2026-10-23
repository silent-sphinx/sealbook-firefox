import type { BookmarkCollection, BookmarkDraft } from "@sealbook/lib/types";

/**
 * The popup/background protocol.
 *
 * Type-guarded on receipt rather than cast: a compromised extension page is the
 * one caller the background has, and a half-formed save must not reach
 * `putSealed` where it would be sealed and signed before anything noticed.
 */
export type Request =
  | { kind: "status" }
  | { kind: "unlock"; password: string }
  | { kind: "lock" }
  | { kind: "beginPairing"; server: string; username: string }
  | { kind: "pairingStatus" }
  | { kind: "completePairing"; password: string }
  | { kind: "cancelPairing" }
  | { kind: "openPairingTab" }
  | { kind: "lookup"; url: string }
  | { kind: "save"; draft: BookmarkDraft; existingId?: string };

export type LockState = "unpaired" | "locked" | "unlocked";

export type Status = {
  lockState: LockState;
  /** Absent while unpaired. Plaintext metadata, so it costs no unlock. */
  account?: { server: string; username: string };
  /** Only known once unlocked and a vault pass has run. */
  bookmarksEnabled?: boolean;
};

export type Lookup = {
  collections: BookmarkCollection[];
  defaultCollectionId: string;
  bookmarksEnabled: boolean;
  /** The bookmark already holding this URL, when the cache knows of one. */
  existing?: { id: string; draft: BookmarkDraft };
};

export type PairingStatus = {
  phase: "idle" | "waiting" | "approved" | "failed";
  /** The eight words the user types into the device that approves this one. */
  pairCode?: string;
  /** The code the user compares against the web app, digit for digit. */
  confirm?: string;
  error?: string;
};

export type Response =
  | { ok: true; kind: "status"; status: Status }
  | { ok: true; kind: "lookup"; lookup: Lookup }
  | { ok: true; kind: "save"; id: string }
  | { ok: true; kind: "pairing"; pairing: PairingStatus }
  | { ok: true; kind: "done" }
  | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isDraft(value: unknown): value is BookmarkDraft {
  if (!isRecord(value)) return false;
  if (typeof value.url !== "string" || typeof value.title !== "string") return false;
  if (typeof value.collectionId !== "string") return false;
  if (value.notes !== undefined && typeof value.notes !== "string") return false;
  if (value.tags !== undefined && !isStringArray(value.tags)) return false;
  if (value.createdAt !== undefined && typeof value.createdAt !== "string") return false;
  if (value.updatedAt !== undefined && typeof value.updatedAt !== "string") return false;
  if (value.raw !== undefined && typeof value.raw !== "string") return false;
  return true;
}

export function isRequest(value: unknown): value is Request {
  if (!isRecord(value) || typeof value.kind !== "string") return false;
  switch (value.kind) {
    case "status":
    case "lock":
    case "pairingStatus":
    case "cancelPairing":
    case "openPairingTab":
      return true;
    case "unlock":
    case "completePairing":
      return typeof value.password === "string" && value.password.length > 0;
    case "beginPairing":
      return typeof value.server === "string" && typeof value.username === "string";
    case "lookup":
      return typeof value.url === "string";
    case "save":
      return (
        isDraft(value.draft) &&
        (value.existingId === undefined || typeof value.existingId === "string")
      );
    default:
      return false;
  }
}
