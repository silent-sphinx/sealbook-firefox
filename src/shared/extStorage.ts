import { b64ToByteArray, b64encode } from "@sealbook/lib/bytes";
import type { DeviceState } from "@sealbook/lib/types";
import { ext } from "./runtime";

/**
 * The device record, and the unlocked material that must not touch disk.
 *
 * Mirrors `sealbook-web/src/lib/storage.ts` on the crypto and swaps the storage
 * area: that module reads `localStorage`, which an extension's background page
 * can see but cannot share with its popup. It deliberately does not import it,
 * which would drag in `idb.ts` and the vault-snapshot layer this extension has
 * no use for.
 *
 * The pre-v1 plaintext branch (`loadUnverifiedLegacyDevice`) is not ported: this
 * repo has no installs that predate the encrypted envelope, so the hazard should
 * not exist here at all.
 */
const DEVICE_KEY = "sealbook.device";
const CACHE_KEY = "sealbook.cache";
const SESSION_KEY = "sealbook.unlocked";
const BOOTSTRAP_KEY = "sealbook.bootstrapped";

const STORAGE_VERSION = 1;
// Source of truth: `sealbook-web/src/lib/storage.ts:28`. Duplicated rather than
// imported, because importing that module brings IndexedDB with it.
const PBKDF2_ITERATIONS = 600_000;

export type DeviceMetadata = Pick<
  DeviceState,
  "server" | "username" | "account_id" | "collection_id" | "device_id"
>;

type Envelope = {
  version: number;
  metadata: DeviceMetadata;
  salt: string;
  iv: string;
  ciphertext: string;
};

type OpaqueEnvelope = {
  version: number;
  salt: string;
  iv: string;
  ciphertext: string;
};

export class DeviceStorageError extends Error {
  constructor(cause: unknown) {
    super(
      "This browser would not store this device's key, so it is not enrolled. " +
        "Allow extension storage and pair again.",
    );
    this.name = "DeviceStorageError";
    this.cause = cause;
  }
}

function metadataOf(state: DeviceState): DeviceMetadata {
  const { server, username, account_id, collection_id, device_id } = state;
  return { server, username, account_id, collection_id, device_id };
}

export async function deriveStorageKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: new Uint8Array(salt).buffer as ArrayBuffer,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    await importPassword(password),
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function importPassword(password: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, [
    "deriveKey",
  ]);
}

async function seal(password: string, plaintext: string): Promise<OpaqueEnvelope> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveStorageKey(password, salt);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  return {
    version: STORAGE_VERSION,
    salt: b64encode(salt),
    iv: b64encode(iv),
    ciphertext: b64encode(new Uint8Array(ciphertext)),
  };
}

async function open(password: string, envelope: OpaqueEnvelope): Promise<string | null> {
  if (envelope.version !== STORAGE_VERSION) return null;
  try {
    const key = await deriveStorageKey(password, Uint8Array.from(b64ToByteArray(envelope.salt)));
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: Uint8Array.from(b64ToByteArray(envelope.iv)) },
      key,
      Uint8Array.from(b64ToByteArray(envelope.ciphertext)),
    );
    return new TextDecoder().decode(plaintext);
  } catch {
    // Expected on a wrong password: the AEAD tag is what checks it.
    return null;
  }
}

export async function saveDevice(state: DeviceState, password: string): Promise<void> {
  // The token is reissued by every login and is the one field worth not keeping,
  // so it is dropped before the state is sealed. Matches `storage.ts`.
  const { session_token: _token, ...secretState } = state;
  const sealed = await seal(password, JSON.stringify(secretState));
  const envelope: Envelope = { ...sealed, metadata: metadataOf(state) };
  try {
    await ext().storage.local.set({ [DEVICE_KEY]: envelope });
  } catch (err) {
    // Without the envelope this browser is not enrolled, and the server-side
    // pairing has already succeeded by now, so the failure is named rather than
    // left as an opaque DOMException.
    throw new DeviceStorageError(err);
  }
}

async function readDevice(): Promise<Envelope | null> {
  const stored = await ext().storage.local.get(DEVICE_KEY);
  const envelope = stored[DEVICE_KEY];
  if (!envelope || typeof envelope !== "object") return null;
  return envelope as Envelope;
}

export async function loadDevice(password: string): Promise<DeviceState | null> {
  const envelope = await readDevice();
  if (!envelope) return null;
  const plaintext = await open(password, envelope);
  if (plaintext === null) return null;
  try {
    return JSON.parse(plaintext) as DeviceState;
  } catch {
    return null;
  }
}

export async function loadDeviceMetadata(): Promise<DeviceMetadata | null> {
  const envelope = await readDevice();
  if (!envelope || envelope.version !== STORAGE_VERSION) return null;
  return envelope.metadata;
}

export async function forgetDevice(): Promise<void> {
  await ext().storage.local.remove([DEVICE_KEY, CACHE_KEY, BOOTSTRAP_KEY]);
  await ext().storage.session.clear();
}

/** The collection cache, encrypted because it holds bookmark titles and URLs. */
export async function saveCache(password: string, cache: unknown): Promise<void> {
  await ext().storage.local.set({ [CACHE_KEY]: await seal(password, JSON.stringify(cache)) });
}

export async function loadCache<T>(password: string): Promise<T | null> {
  const stored = await ext().storage.local.get(CACHE_KEY);
  const envelope = stored[CACHE_KEY];
  if (!envelope || typeof envelope !== "object") return null;
  const plaintext = await open(password, envelope as OpaqueEnvelope);
  if (plaintext === null) return null;
  try {
    return JSON.parse(plaintext) as T;
  } catch {
    return null;
  }
}

/**
 * What an unlocked background page needs to rebuild its `Session` after the
 * event page has been suspended.
 *
 * Kept in `storage.session`: memory-backed, never written to disk, cleared on
 * browser shutdown, and out of reach of content scripts. The password is part of
 * it so a 401 can be answered by a silent re-login rather than a prompt; see the
 * README on that trade.
 */
export type Unlocked = {
  state: DeviceState;
  collectionKey: string;
  token: string;
  latestRevision: number;
  keyEpoch: number;
  manifestSeq: number;
  password: string;
};

export async function saveUnlocked(unlocked: Unlocked): Promise<void> {
  await ext().storage.session.set({ [SESSION_KEY]: unlocked });
}

export async function loadUnlocked(): Promise<Unlocked | null> {
  const stored = await ext().storage.session.get(SESSION_KEY);
  const unlocked = stored[SESSION_KEY];
  if (!unlocked || typeof unlocked !== "object") return null;
  return unlocked as Unlocked;
}

export async function lock(): Promise<void> {
  await ext().storage.session.clear();
}

/**
 * Whether the one-time setup after pairing has run.
 *
 * `ensureDefaultBookmarkCollection` writes, and a write that fails on the
 * refresh path would stop the whole popup loading, so it is run once and this
 * records that. Plaintext: it says nothing about the account.
 */
export async function hasBootstrapped(): Promise<boolean> {
  const stored = await ext().storage.local.get(BOOTSTRAP_KEY);
  return stored[BOOTSTRAP_KEY] === true;
}

export async function markBootstrapped(): Promise<void> {
  await ext().storage.local.set({ [BOOTSTRAP_KEY]: true });
}
