import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@sealbook/lib";
import { installExtensionStub, removeExtensionStub } from "../test/extension";
import type { Cache } from "./collections";

const putBookmark = vi.fn<(...args: never[]) => Promise<unknown>>();
const newBookmarkId = vi.fn<() => string>(() => "fresh-id");

vi.mock("@sealbook/lib", () => ({ putBookmark, newBookmarkId }));

const { draftFromEntry, DraftRejected, saveBookmark } = await import("./save");
const { DEFAULT_BOOKMARK_COLLECTION_ID } = await import("@sealbook/lib/bookmark");

const PASSWORD = "correct horse battery";
const session = {
  state: { collection_id: "coll-1" },
  manifestSeq: 42,
} as unknown as Session;

function cache(): Cache {
  return {
    manifestSeq: 41,
    collections: [{ id: DEFAULT_BOOKMARK_COLLECTION_ID, name: "Default Collection", raw: "{}" }],
    bookmarksEnabled: true,
    urlIndex: {},
  };
}

beforeEach(() => {
  installExtensionStub();
  putBookmark.mockReset();
  putBookmark.mockResolvedValue("written");
  newBookmarkId.mockClear();
});

afterEach(() => {
  removeExtensionStub();
});

describe("saving a new URL", () => {
  it("issues a fresh id and folds the write into the cache", async () => {
    const { id, cache: next } = await saveBookmark(session, PASSWORD, cache(), {
      url: "example.com",
      title: "Example",
      collectionId: DEFAULT_BOOKMARK_COLLECTION_ID,
    });

    expect(id).toBe("fresh-id");
    expect(newBookmarkId).toHaveBeenCalledTimes(1);
    // The sequence the write advanced to, not another manifest fetch.
    expect(next.manifestSeq).toBe(42);
    expect(next.urlIndex["https://example.com"]?.id).toBe("fresh-id");
  });
});

describe("saving a URL already in the vault", () => {
  it("writes to the existing id rather than adding a second row", async () => {
    const existing = draftFromEntry(
      {
        id: "b1",
        title: "Old title",
        collectionId: "c-zz",
        createdAt: "2026-01-01T00:00:00.000Z",
        raw: '{"url":"https://example.com","somethingNewer":true}',
      },
      "https://example.com",
    );

    const { id } = await saveBookmark(
      session,
      PASSWORD,
      cache(),
      { ...existing, title: "New title" },
      "b1",
    );

    expect(id).toBe("b1");
    expect(newBookmarkId).not.toHaveBeenCalled();
    const [, draft] = putBookmark.mock.calls[0] as unknown as [
      unknown,
      { raw?: string; createdAt?: string },
    ];
    // Both carried: `raw` is what `mergePayload` keeps a newer client's keys
    // from, and `createdAt` would otherwise be reset to now by the edit.
    expect(draft.raw).toContain("somethingNewer");
    expect(draft.createdAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("keeps the unknown keys in the payload it actually writes", async () => {
    const existing = draftFromEntry(
      {
        id: "b1",
        title: "Old",
        collectionId: DEFAULT_BOOKMARK_COLLECTION_ID,
        raw: '{"url":"https://example.com","somethingNewer":true}',
      },
      "https://example.com",
    );

    const { cache: next } = await saveBookmark(
      session,
      PASSWORD,
      cache(),
      { ...existing, title: "New" },
      "b1",
    );

    // The cached `raw` is what the *next* edit merges onto, so the unknown key
    // has to survive this round too or it is lost on the one after.
    expect(next.urlIndex["https://example.com"]?.raw).toContain("somethingNewer");
  });
});

describe("a draft the server would refuse", () => {
  it("rejects a URL no browser could open, before any crypto", async () => {
    await expect(
      saveBookmark(session, PASSWORD, cache(), {
        url: "about:config",
        title: "Config",
        collectionId: DEFAULT_BOOKMARK_COLLECTION_ID,
      }),
    ).rejects.toThrow(DraftRejected);
    expect(putBookmark).not.toHaveBeenCalled();
  });

  it("rejects an oversized draft before any crypto, since the server answers 400", async () => {
    await expect(
      saveBookmark(session, PASSWORD, cache(), {
        url: "https://example.com",
        title: "Example",
        notes: "x".repeat(9 * 1024 * 1024),
        collectionId: DEFAULT_BOOKMARK_COLLECTION_ID,
      }),
    ).rejects.toThrow(/too large/u);
    expect(putBookmark).not.toHaveBeenCalled();
  });

  it("does not touch the cache when the write itself fails", async () => {
    putBookmark.mockRejectedValue(new Error("server said no"));
    const before = cache();

    await expect(
      saveBookmark(session, PASSWORD, before, {
        url: "https://example.com",
        title: "Example",
        collectionId: DEFAULT_BOOKMARK_COLLECTION_ID,
      }),
    ).rejects.toThrow("server said no");

    expect(before.urlIndex).toEqual({});
  });
});
