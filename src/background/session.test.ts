import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@sealbook/lib";
import type { DeviceState } from "@sealbook/lib/types";
import { installExtensionStub, removeExtensionStub, type ExtensionStub } from "../test/extension";

class ApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApiError";
  }
}

const loginAccount = vi.fn<(...args: never[]) => Promise<unknown>>();
const setProxyLoopback = vi.fn<(enabled: boolean) => void>();
const initWasm = vi.fn<() => Promise<void>>(async () => {});
const protocolVersion = vi.fn<() => string>(() => "sealbook-v1");
const payloadSchemaVersion = vi.fn<() => string>(() => "1.0");

vi.mock("@sealbook/lib", () => ({ ApiError, loginAccount, setProxyLoopback }));
vi.mock("@sealbook/lib/wasm", () => ({ initWasm, protocolVersion, payloadSchemaVersion }));

const { currentSession, dropSession, LockedError, openSession, withSession } = await import(
  "./session"
);
const { loadUnlocked, saveUnlocked } = await import("../shared/extStorage");

const PASSWORD = "correct horse battery";

function deviceState(): DeviceState {
  return {
    server: "https://127.0.0.1:8443",
    username: "alice",
    account_id: "acct-1",
    collection_id: "coll-1",
    device_id: "dev-1",
    kdf_salt: [1],
    hpke_sk: [2],
    mldsa_seed: [3],
    ed25519_sk: [4],
    manifest_seq: 7,
  };
}

function unlocked(token = "tok") {
  return {
    state: deviceState(),
    collectionKey: "ck",
    token,
    latestRevision: 4,
    keyEpoch: 1,
    manifestSeq: 7,
    password: PASSWORD,
  };
}

let ext: ExtensionStub;

beforeEach(() => {
  ext = installExtensionStub();
  dropSession();
  loginAccount.mockReset();
  setProxyLoopback.mockClear();
  initWasm.mockClear();
  protocolVersion.mockReturnValue("sealbook-v1");
  payloadSchemaVersion.mockReturnValue("1.0");
});

afterEach(() => {
  removeExtensionStub();
});

describe("loading the crypto module", () => {
  // The load is memoized for the life of the page, which is the point of it, so
  // each case here needs a page of its own.
  async function freshModule() {
    vi.resetModules();
    return import("./session");
  }

  it("turns the proxy collapse off, since a relative path has nothing to proxy here", async () => {
    await (await freshModule()).ensureWasm();
    expect(setProxyLoopback).toHaveBeenCalledWith(false);
  });

  it("runs init once per wake, not once per call", async () => {
    const module = await freshModule();
    await module.ensureWasm();
    await module.ensureWasm();
    expect(initWasm).toHaveBeenCalledTimes(1);
  });

  it("treats a stale module as fatal rather than logging and continuing", async () => {
    // `initWasm` logs and returns on a mismatch, which is right for the web app.
    // Here the next step would sign a manifest with it.
    payloadSchemaVersion.mockReturnValue("0.9");
    await expect((await freshModule()).ensureWasm()).rejects.toThrow(/stale/u);
  });

  it("does not cache the failure, so a rebuilt module is picked up on the next try", async () => {
    const module = await freshModule();
    payloadSchemaVersion.mockReturnValue("0.9");
    await expect(module.ensureWasm()).rejects.toThrow(/stale/u);

    payloadSchemaVersion.mockReturnValue("1.0");
    await expect(module.ensureWasm()).resolves.toBeUndefined();
  });
});

describe("waking after a suspension", () => {
  it("rebuilds the session from the session area, with no password prompt", async () => {
    await saveUnlocked(unlocked());

    const session = await currentSession();

    expect(session.collectionKey).toBe("ck");
    expect(session.manifestSeq).toBe(7);
    expect(loginAccount).not.toHaveBeenCalled();
  });

  it("reports itself locked when there is nothing unlocked to rebuild from", async () => {
    await expect(currentSession()).rejects.toThrow(LockedError);
  });
});

describe("a write under an expired token", () => {
  it("re-logs in silently once and retries, with no prompt", async () => {
    await saveUnlocked(unlocked());
    loginAccount.mockResolvedValue({ ...unlocked("fresh-token"), state: deviceState() });

    const run = vi
      .fn<(session: Session) => Promise<unknown>>()
      .mockRejectedValueOnce(new ApiError("expired token"))
      .mockResolvedValueOnce("written");

    await expect(withSession(run)).resolves.toBe("written");
    expect(loginAccount).toHaveBeenCalledTimes(1);
    expect(loginAccount).toHaveBeenCalledWith(expect.objectContaining({ device_id: "dev-1" }), PASSWORD);
    expect(run).toHaveBeenCalledTimes(2);
    // The new token replaces the dead one, so the next wake does not repeat this.
    expect((await loadUnlocked())?.token).toBe("fresh-token");
  });

  it("does not retry a refusal that is not about the token", async () => {
    await saveUnlocked(unlocked());
    const run = vi
      .fn<(session: Session) => Promise<unknown>>()
      .mockRejectedValue(new ApiError("collection is full"));

    await expect(withSession(run)).rejects.toThrow("collection is full");
    expect(loginAccount).not.toHaveBeenCalled();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("gives up after one retry rather than looping on OPAQUE login", async () => {
    await saveUnlocked(unlocked());
    loginAccount.mockResolvedValue({ ...unlocked("fresh-token"), state: deviceState() });
    const run = vi
      .fn<(session: Session) => Promise<unknown>>()
      .mockRejectedValue(new ApiError("expired token"));

    await expect(withSession(run)).rejects.toThrow("expired token");
    expect(loginAccount).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledTimes(2);
  });
});

describe("the rollback anchors", () => {
  it("are written back to disk after a write advances them", async () => {
    await saveUnlocked(unlocked());

    await withSession(async (session) => {
      // What `rememberManifestSeq` does inside `putSealed`.
      session.manifestSeq = 9;
      session.state.manifest_seq = 9;
    });

    expect((await loadUnlocked())?.manifestSeq).toBe(9);
    // And in the encrypted envelope, so a browser restart cannot rewind it.
    const { loadDevice } = await import("../shared/extStorage");
    expect((await loadDevice(PASSWORD))?.manifest_seq).toBe(9);
  });

  it("are persisted by opening a session, so a pairing's pin survives a restart", async () => {
    await openSession(
      { ...unlocked(), state: { ...deviceState(), manifest_seq: 3 } } as never,
      PASSWORD,
    );

    expect(ext.storage.local.store.has("sealbook.device")).toBe(true);
    expect((await loadUnlocked())?.password).toBe(PASSWORD);
  });
});
