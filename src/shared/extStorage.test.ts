import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DeviceState } from "@sealbook/lib/types";
import { localStorageKdf } from "@sealbook/lib/wasm";
import { installExtensionStub, removeExtensionStub, type ExtensionStub } from "../test/extension";
import {
  deriveStorageKey,
  forgetDevice,
  hasBootstrapped,
  loadCache,
  loadDevice,
  loadDeviceMetadata,
  loadUnlocked,
  lock,
  markBootstrapped,
  saveCache,
  saveDevice,
  saveUnlocked,
} from "./extStorage";

const PASSWORD = "correct horse battery";

function deviceState(): DeviceState {
  return {
    server: "https://127.0.0.1:8443",
    username: "alice",
    account_id: "acct-1",
    collection_id: "coll-1",
    device_id: "dev-1",
    session_token: "a-token-that-must-not-be-stored",
    hpke_sk: [4, 5, 6],
    mldsa_seed: [7, 8, 9],
    ed25519_sk: [10, 11, 12],
    manifest_seq: 7,
    roster_seq: 3,
    roster_transcript: "dHJhbnNjcmlwdA==",
  };
}

let ext: ExtensionStub;

beforeEach(() => {
  ext = installExtensionStub();
});

afterEach(() => {
  removeExtensionStub();
});

describe("the device envelope", () => {
  it("round-trips the state under the right password", async () => {
    const state = deviceState();
    await saveDevice(state, PASSWORD);

    const loaded = await loadDevice(PASSWORD);
    expect(loaded?.device_id).toBe("dev-1");
    expect(loaded?.hpke_sk).toEqual([4, 5, 6]);
    // Carried because they are the rollback anchors: a restart that lost them
    // would rewind this device's high-water mark.
    expect(loaded?.manifest_seq).toBe(7);
    expect(loaded?.roster_seq).toBe(3);
  });

  /**
   * A record written before the protocol dropped the password wrap carries the
   * salt that wrap used. It is still read, and never written back.
   */
  it("reads a record that still holds the stale salt, and does not write it again", async () => {
    // Sealed as an old build did, bypassing the writer that now drops the salt.
    await saveDevice(deviceState(), PASSWORD);
    const loaded = { ...(await loadDevice(PASSWORD)), kdf_salt: [1, 2, 3] } as DeviceState;
    expect(loaded.kdf_salt).toEqual([1, 2, 3]);


    await saveDevice(loaded as DeviceState, PASSWORD);
    const rewritten = await loadDevice(PASSWORD);
    expect(rewritten?.device_id).toBe("dev-1");
    expect(rewritten).not.toHaveProperty("kdf_salt");
  });

  it("returns null under the wrong password rather than throwing", async () => {
    await saveDevice(deviceState(), PASSWORD);
    expect(await loadDevice("not the password")).toBeNull();
  });

  it("leaves the session token out of the ciphertext", async () => {
    await saveDevice(deviceState(), PASSWORD);
    const loaded = await loadDevice(PASSWORD);
    expect(loaded).not.toBeNull();
    expect("session_token" in (loaded as object)).toBe(false);
  });

  it("stores the metadata in plaintext and nothing secret with it", async () => {
    await saveDevice(deviceState(), PASSWORD);

    const metadata = await loadDeviceMetadata();
    expect(metadata).toEqual({
      server: "https://127.0.0.1:8443",
      username: "alice",
      account_id: "acct-1",
      collection_id: "coll-1",
      device_id: "dev-1",
    });

    // The whole record, read as the browser holds it: no key material anywhere
    // outside the ciphertext.
    const stored = JSON.stringify(ext.storage.local.store.get("sealbook.device"));
    for (const secret of ["hpke_sk", "mldsa_seed", "ed25519_sk", "a-token"]) {
      expect(stored).not.toContain(secret);
    }
  });

  it("refuses a record from another storage version", async () => {
    await saveDevice(deviceState(), PASSWORD);
    const envelope = ext.storage.local.store.get("sealbook.device") as { version: number };
    ext.storage.local.store.set("sealbook.device", { ...envelope, version: 2 });

    expect(await loadDevice(PASSWORD)).toBeNull();
    expect(await loadDeviceMetadata()).toBeNull();
  });

  it("decrypts an envelope written by sealbook-web's storage.ts", async () => {
    // The strongest case available: the two modules derive the same key and use
    // the same envelope, so a drift in either is caught here rather than by a
    // user whose paired extension stops opening.
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveStorageKey(PASSWORD, salt);
    const state = deviceState();
    const { session_token: _token, ...secret } = state;
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      new TextEncoder().encode(JSON.stringify(secret)),
    );
    const { b64encode } = await import("@sealbook/lib/bytes");
    ext.storage.local.store.set("sealbook.device", {
      version: 1,
      metadata: {
        server: state.server,
        username: state.username,
        account_id: state.account_id,
        collection_id: state.collection_id,
        device_id: state.device_id,
      },
      salt: b64encode(salt),
      iv: b64encode(iv),
      ciphertext: b64encode(new Uint8Array(ciphertext)),
    });

    expect((await loadDevice(PASSWORD))?.device_id).toBe("dev-1");
  });

  it("seals a new record under Argon2id and names the suite", async () => {
    await saveDevice(deviceState(), PASSWORD);
    const envelope = ext.storage.local.store.get("sealbook.device") as { kdf?: string };
    expect(envelope.kdf).toBe(localStorageKdf());
  });

  it("opens a PBKDF2 record and re-seals it under Argon2id", async () => {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const state = deviceState();
    const key = await deriveStorageKey(PASSWORD, salt);
    const { session_token: _token, ...secret } = state;
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      new TextEncoder().encode(JSON.stringify(secret)),
    );
    const { b64encode } = await import("@sealbook/lib/bytes");
    ext.storage.local.store.set("sealbook.device", {
      version: 1,
      metadata: {
        server: state.server,
        username: state.username,
        account_id: state.account_id,
        collection_id: state.collection_id,
        device_id: state.device_id,
      },
      salt: b64encode(salt),
      iv: b64encode(iv),
      ciphertext: b64encode(new Uint8Array(ciphertext)),
    });

    expect((await loadDevice("not the password"))?.device_id).toBeUndefined();
    expect((ext.storage.local.store.get("sealbook.device") as { kdf?: string }).kdf).toBeUndefined();

    expect((await loadDevice(PASSWORD))?.device_id).toBe("dev-1");
    const resealed = ext.storage.local.store.get("sealbook.device") as { kdf?: string };
    expect(resealed.kdf).toBe(localStorageKdf());
    expect((await loadDevice(PASSWORD))?.hpke_sk).toEqual([4, 5, 6]);
  });

  it("refuses a record whose metadata was swapped for another account's", async () => {
    await saveDevice(deviceState(), PASSWORD);
    const envelope = ext.storage.local.store.get("sealbook.device") as {
      metadata: Record<string, string>;
    };
    ext.storage.local.store.set("sealbook.device", {
      ...envelope,
      metadata: { ...envelope.metadata, account_id: "acct-2" },
    });

    expect(await loadDevice(PASSWORD)).toBeNull();
  });
});

describe("the unlocked material", () => {
  it("lives in the session area, which a suspension keeps and a restart does not", async () => {
    await saveUnlocked({
      state: deviceState(),
      collectionKey: "ck",
      token: "tok",
      latestRevision: 4,
      keyEpoch: 1,
      manifestSeq: 7,
      password: PASSWORD,
    });

    expect(ext.storage.local.store.has("sealbook.unlocked")).toBe(false);
    expect((await loadUnlocked())?.collectionKey).toBe("ck");

    await lock();
    expect(await loadUnlocked()).toBeNull();
  });
});

describe("the collection cache", () => {
  it("is encrypted, because it holds bookmark titles and URLs", async () => {
    await saveCache(PASSWORD, { urlIndex: { "https://example.com": { title: "Example" } } });

    expect(JSON.stringify(ext.storage.local.store.get("sealbook.cache"))).not.toContain("example");
    expect(await loadCache(PASSWORD)).toEqual({
      urlIndex: { "https://example.com": { title: "Example" } },
    });
    expect(await loadCache("wrong")).toBeNull();
  });
});

describe("forgetting the device", () => {
  it("drops the envelope, the cache and the one-time setup flag together", async () => {
    await saveDevice(deviceState(), PASSWORD);
    await saveCache(PASSWORD, { urlIndex: {} });
    await markBootstrapped();

    await forgetDevice();

    expect(await loadDeviceMetadata()).toBeNull();
    expect(await loadCache(PASSWORD)).toBeNull();
    expect(await hasBootstrapped()).toBe(false);
  });
});
