import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@sealbook/lib";
import type { Bookmark } from "@sealbook/lib/types";
import { installExtensionStub, removeExtensionStub } from "../test/extension";

const listVault = vi.fn<(...args: never[]) => Promise<unknown>>();
const manifestState = vi.fn<(...args: never[]) => Promise<unknown>>();

// Mocked rather than exercised: the protocol layer has its own suite in
// sealbook-web, and running it twice is how the two drift.
vi.mock("@sealbook/lib", () => ({ listVault }));
vi.mock("@sealbook/lib/clientCore", () => ({ manifestState }));

const { buildIndex, defaultCollectionId, readCache, recordSave } = await import("./collections");
const { DEFAULT_BOOKMARK_COLLECTION_ID } = await import("@sealbook/lib/bookmark");

const PASSWORD = "correct horse battery";
const session = { state: { collection_id: "coll-1" } } as unknown as Session;

function bookmark(overrides: Partial<Bookmark>): Bookmark {
  return {
    id: "b1",
    raw: "{}",
    url: "https://example.com",
    title: "Example",
    tags: [],
    collectionId: DEFAULT_BOOKMARK_COLLECTION_ID,
    ...overrides,
  };
}

function listing(bookmarks: Bookmark[], bookmarksEnabled = true) {
  return {
    bookmarks,
    bookmarkCollections: [
      { id: "c-zz", name: "Zebra", raw: "{}" },
      { id: DEFAULT_BOOKMARK_COLLECTION_ID, name: "Default Collection", raw: "{}" },
    ],
    accountSettings: { features: { bookmarks: bookmarksEnabled } },
  };
}

beforeEach(() => {
  installExtensionStub();
  listVault.mockReset();
  manifestState.mockReset();
});

afterEach(() => {
  removeExtensionStub();
});

describe("the cache's freshness check", () => {
  it("serves from the cache without a listing when the sequence has not moved", async () => {
    manifestState.mockResolvedValue({ seq: 12 });
    listVault.mockResolvedValue(listing([bookmark({})]));

    const first = await readCache(session, PASSWORD);
    expect(first.listed).toBe(true);
    expect(listVault).toHaveBeenCalledTimes(1);

    // The steady state: popup open, one authenticated GET, no vault download.
    const second = await readCache(session, PASSWORD);
    expect(second.listed).toBe(false);
    expect(listVault).toHaveBeenCalledTimes(1);
    expect(second.cache.urlIndex["https://example.com"]?.id).toBe("b1");
  });

  it("runs exactly one listing when the sequence has moved on", async () => {
    manifestState.mockResolvedValue({ seq: 12 });
    listVault.mockResolvedValue(listing([bookmark({})]));
    await readCache(session, PASSWORD);

    manifestState.mockResolvedValue({ seq: 13 });
    const refreshed = await readCache(session, PASSWORD);

    expect(refreshed.listed).toBe(true);
    expect(listVault).toHaveBeenCalledTimes(2);
    expect(refreshed.cache.manifestSeq).toBe(13);
  });

  it("carries the account's bookmarks flag, so the popup can say it is off", async () => {
    manifestState.mockResolvedValue({ seq: 1 });
    listVault.mockResolvedValue(listing([], false));

    const { cache } = await readCache(session, PASSWORD);
    expect(cache.bookmarksEnabled).toBe(false);
  });

  it("puts the default collection first, whatever order the vault served", async () => {
    manifestState.mockResolvedValue({ seq: 1 });
    listVault.mockResolvedValue(listing([]));

    const { cache } = await readCache(session, PASSWORD);
    expect(cache.collections[0]?.id).toBe(DEFAULT_BOOKMARK_COLLECTION_ID);
    expect(defaultCollectionId(cache)).toBe(DEFAULT_BOOKMARK_COLLECTION_ID);
  });
});

describe("the URL index", () => {
  it("is keyed on the normalized URL, so a bare host and an https one collide", () => {
    const index = buildIndex([bookmark({ id: "b1", url: "example.com" })]);

    expect(Object.keys(index)).toEqual(["https://example.com"]);
    expect(index["https://example.com"]?.id).toBe("b1");
  });

  it("keeps the most recently saved of two rows sharing a URL", () => {
    const index = buildIndex([
      bookmark({ id: "old", updatedAt: "2026-01-01T00:00:00.000Z" }),
      bookmark({ id: "new", updatedAt: "2026-06-01T00:00:00.000Z" }),
    ]);

    expect(index["https://example.com"]?.id).toBe("new");
  });

  it("carries each entry's stored payload, which an edit has to merge onto", () => {
    const raw = '{"url":"https://example.com","somethingNewer":true}';
    const index = buildIndex([bookmark({ raw })]);

    expect(index["https://example.com"]?.raw).toBe(raw);
  });

  it("skips a bookmark with no URL rather than indexing an empty key", () => {
    expect(buildIndex([bookmark({ url: "" })])).toEqual({});
  });
});

describe("folding a write into the cache", () => {
  it("updates the entry and the sequence without another listing", async () => {
    manifestState.mockResolvedValue({ seq: 12 });
    listVault.mockResolvedValue(listing([bookmark({})]));
    const { cache } = await readCache(session, PASSWORD);

    const next = await recordSave(
      PASSWORD,
      cache,
      13,
      { id: "b1", title: "Renamed", collectionId: "c-zz", raw: "{}" },
      "https://example.com",
    );

    expect(next.manifestSeq).toBe(13);
    expect(next.urlIndex["https://example.com"]?.title).toBe("Renamed");
    expect(listVault).toHaveBeenCalledTimes(1);

    // Written through, so the next popup open reads it back from the cache: the
    // server is at the sequence the write advanced it to.
    manifestState.mockResolvedValue({ seq: 13 });
    const reread = await readCache(session, PASSWORD);
    expect(reread.listed).toBe(false);
    expect(reread.cache.urlIndex["https://example.com"]?.title).toBe("Renamed");
  });
});
