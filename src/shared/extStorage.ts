import { b64ToByteArray, b64encode } from "@sealbook/lib/bytes";
import type { DeviceState } from "@sealbook/lib/types";
import { localStorageKdf, localStorageKey } from "@sealbook/lib/wasm";
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
  /** The stretching suite the key came from; absent on a record made under PBKDF2. */
  kdf?: string;
  salt: string;
  iv: string;
  ciphertext: string;
};

type OpaqueEnvelope = {
  version: number;
  kdf?: string;
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

/**
 * The key for something kept under the password. A record that names no suite
 * predates Argon2id and was made under PBKDF2, which is kept only so such a
 * record can still be read and then re-saved. Argon2id runs in the wasm
 * module, which the caller must already have initialised.
 */
export async function deriveStorageKey(
  password: string,
  salt: Uint8Array,
  kdf?: string,
): Promise<CryptoKey> {
  if (kdf) {
    const stretched = Uint8Array.from(b64ToByteArray(localStorageKey(password, b64encode(salt), kdf)));
    return crypto.subtle.importKey("raw", stretched, "AES-GCM", false, ["encrypt", "decrypt"]);
  }
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

/**
 * What the device ciphertext is bound to, so the plaintext metadata beside it
 * cannot be swapped for another account's without the record failing to open.
 * Matches `metadataAad` in `sealbook-web/src/lib/storage.ts`.
 */
function metadataAad(metadata: DeviceMetadata): Uint8Array<ArrayBuffer> {
  const { server, username, account_id, collection_id, device_id } = metadata;
  return new TextEncoder().encode(
    JSON.stringify([server, username, account_id, collection_id, device_id]),
  );
}

async function seal(
  password: string,
  plaintext: string,
  aad?: Uint8Array<ArrayBuffer>,
): Promise<OpaqueEnvelope> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const kdf = localStorageKdf();
  const key = await deriveStorageKey(password, salt, kdf);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, ...(aad ? { additionalData: aad } : {}) },
    key,
    new TextEncoder().encode(plaintext),
  );
  return {
    version: STORAGE_VERSION,
    kdf,
    salt: b64encode(salt),
    iv: b64encode(iv),
    ciphertext: b64encode(new Uint8Array(ciphertext)),
  };
}

async function open(
  password: string,
  envelope: OpaqueEnvelope,
  aad?: Uint8Array<ArrayBuffer>,
): Promise<string | null> {
  if (envelope.version !== STORAGE_VERSION) return null;
  try {
    const key = await deriveStorageKey(
      password,
      Uint8Array.from(b64ToByteArray(envelope.salt)),
      envelope.kdf,
    );
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: Uint8Array.from(b64ToByteArray(envelope.iv)),
        // A record without a suite predates the binding.
        ...(envelope.kdf && aad ? { additionalData: aad } : {}),
      },
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
  // The salt belonged to the password wrap the protocol no longer has; a record
  // that still holds it is read, and it goes when the record is next saved.
  const { session_token: _token, kdf_salt: _staleSalt, ...secretState } = state;
  const metadata = metadataOf(state);
  const sealed = await seal(password, JSON.stringify(secretState), metadataAad(metadata));
  const envelope: Envelope = { ...sealed, metadata };
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
  const plaintext = await open(password, envelope, metadataAad(envelope.metadata));
  if (plaintext === null) return null;
  let state: DeviceState;
  try {
    state = JSON.parse(plaintext) as DeviceState;
  } catch {
    return null;
  }
  if (!envelope.kdf) {
    // The password is in hand, which is the only time an older record can be
    // moved off PBKDF2. Failing to is not a failed unlock.
    try {
      await saveDevice(state, password);
    } catch {
      // The old record still opens next time.
    }
  }
  return state;
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
