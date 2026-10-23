import { ApiError, loginAccount, setProxyLoopback, type Session } from "@sealbook/lib";
import { PAYLOAD_SCHEMA_VERSION } from "@sealbook/lib/payload";
import { PROTOCOL_VERSION } from "@sealbook/lib/protocol";
import { initWasm, payloadSchemaVersion, protocolVersion } from "@sealbook/lib/wasm";
import { loadUnlocked, saveDevice, saveUnlocked, type Unlocked } from "../shared/extStorage";

/**
 * The background page's session, rebuilt on every wake.
 *
 * An MV3 event page is suspended when idle, so nothing here survives between
 * message handlers. The unlocked material lives in `storage.session` instead
 * (see `extStorage.Unlocked`) and this module reassembles a `Session` from it,
 * which is cheap: no network, and `initWasm` once per wake.
 */
let session: Session | null = null;
let wasmReady: Promise<void> | null = null;

export class LockedError extends Error {
  constructor() {
    super("Sealbook is locked. Open the popup and enter your password.");
    this.name = "LockedError";
  }
}

/**
 * Loads the crypto module, treating a version mismatch as fatal.
 *
 * `initWasm` logs a mismatch and returns, which is right for the web app: the
 * user is looking at a console and the page still renders. Here the next step
 * would be a manifest signed by a module that disagrees with this build, so the
 * extension fails as itself rather than as a transcript that will not verify.
 */
export function ensureWasm(): Promise<void> {
  wasmReady ??= (async () => {
    // A relative `/v1/...` would resolve against moz-extension://<uuid>/ and
    // 404 against the extension's own package. Set before any request is made.
    setProxyLoopback(false);
    await initWasm();
    const built = { protocol: protocolVersion(), payload: payloadSchemaVersion() };
    if (built.protocol !== PROTOCOL_VERSION || built.payload !== PAYLOAD_SCHEMA_VERSION) {
      wasmReady = null;
      throw new Error(
        `The bundled crypto module is stale: it speaks ${built.protocol}/${built.payload}, ` +
          `this build speaks ${PROTOCOL_VERSION}/${PAYLOAD_SCHEMA_VERSION}. Rebuild with npm run wasm.`,
      );
    }
  })();
  return wasmReady;
}

function sessionFrom(unlocked: Unlocked): Session {
  return {
    state: unlocked.state,
    collectionKey: unlocked.collectionKey,
    token: unlocked.token,
    latestRevision: unlocked.latestRevision,
    keyEpoch: unlocked.keyEpoch,
    manifestSeq: unlocked.manifestSeq,
  };
}

async function persist(current: Session, password: string): Promise<void> {
  // Two writes, both needed after anything that advances the rollback anchors:
  // `storage.session` so the next wake rehydrates them, and the device envelope
  // so a browser restart cannot rewind the high-water mark.
  await saveUnlocked({
    state: current.state,
    collectionKey: current.collectionKey,
    token: current.token,
    latestRevision: current.latestRevision,
    keyEpoch: current.keyEpoch,
    manifestSeq: current.manifestSeq,
    password,
  });
  await saveDevice(current.state, password);
}

/** The password of the current unlock, needed for a re-login and for `saveDevice`. */
export async function currentPassword(): Promise<string | null> {
  return (await loadUnlocked())?.password ?? null;
}

export async function currentSession(): Promise<Session> {
  await ensureWasm();
  if (session) return session;
  const unlocked = await loadUnlocked();
  if (!unlocked) throw new LockedError();
  session = sessionFrom(unlocked);
  return session;
}

export function adoptSession(next: Session): void {
  session = next;
}

export function dropSession(): void {
  session = null;
}

export async function hasUnlocked(): Promise<boolean> {
  return (await loadUnlocked()) !== null;
}

/**
 * The exact refusals the server sends for a dead bearer token
 * (`crates/sealbook-server/src/session.rs`). `ApiError` carries only the body's
 * message, so this is the available signal; matched narrowly rather than on the
 * word "token" so an unrelated refusal is not retried as an expiry.
 */
const EXPIRED = ["expired token", "invalid token", "missing token", "recent login required"];

function isExpiredSession(err: unknown): boolean {
  if (!(err instanceof ApiError)) return false;
  const message = err.message.toLowerCase();
  return EXPIRED.some((refusal) => message.includes(refusal));
}

/**
 * Runs a protocol call, answering an expired session with one silent re-login.
 *
 * The token's TTL is 24 hours, so a browser left open past a day gets a 401 on
 * the next save. The password is in `storage.session`, so the re-login needs no
 * prompt. Exactly one retry: a second failure is a real refusal, and a loop here
 * would hammer OPAQUE login.
 */
export async function withSession<T>(run: (session: Session) => Promise<T>): Promise<T> {
  const password = await currentPassword();
  if (password === null) throw new LockedError();
  const current = await currentSession();
  try {
    const result = await run(current);
    await persist(current, password);
    return result;
  } catch (err) {
    if (!isExpiredSession(err)) throw err;
    const renewed = await loginAccount(current.state, password);
    adoptSession(renewed);
    const result = await run(renewed);
    await persist(renewed, password);
    return result;
  }
}

/** Replaces the unlocked material after a login or a pairing. */
export async function openSession(next: Session, password: string): Promise<void> {
  adoptSession(next);
  await persist(next, password);
}
