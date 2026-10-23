import { listVault, type Session } from "@sealbook/lib";
import {
  DEFAULT_BOOKMARK_COLLECTION_ID,
  normalizeUrl,
  sortCollections,
} from "@sealbook/lib/bookmark";
import { manifestState } from "@sealbook/lib/clientCore";
import type { Bookmark, BookmarkCollection } from "@sealbook/lib/types";
import { loadCache, saveCache } from "../shared/extStorage";

/**
 * The collection list and URL index the popup paints from.
 *
 * `listVault` decrypts the whole vault and the server has no content-type
 * filter, so it cannot sit on the popup path. The cache stands in, and its
 * freshness is checked against the manifest sequence: one cheap authenticated
 * GET, which is already authenticated and rollback-checked. Equal means serve
 * from the cache and make no further request, which is the steady state.
 */
export type IndexEntry = {
  id: string;
  title: string;
  notes?: string;
  tags?: string[];
  collectionId: string;
  createdAt?: string;
  /**
   * The payload as stored. Carried so an edit merges onto it: without it
   * `mergePayload` drops every key a newer client wrote.
   */
  raw: string;
};

export type Cache = {
  manifestSeq: number;
  collections: BookmarkCollection[];
  bookmarksEnabled: boolean;
  /** Keyed on `normalizeUrl`, so `example.com` and `https://example.com` collide. */
  urlIndex: Record<string, IndexEntry>;
};

/**
 * The index is capped because `storage.session` holds 10 MB and the encrypted
 * copy grows with the account. Past the cap the newest entries are kept: a miss
 * costs a duplicate row, not a lost bookmark.
 */
const MAX_INDEXED = 2000;

function savedAt(bookmark: Bookmark): number {
  const stamp = bookmark.updatedAt ?? bookmark.createdAt;
  const parsed = stamp ? Date.parse(stamp) : Number.NaN;
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function buildIndex(bookmarks: Bookmark[]): Record<string, IndexEntry> {
  const index: Record<string, IndexEntry> = {};
  const newestFirst = [...bookmarks].sort((a, b) => savedAt(b) - savedAt(a)).slice(0, MAX_INDEXED);
  for (const bookmark of newestFirst) {
    const key = normalizeUrl(bookmark.url);
    if (!key) continue;
    // First wins: the list is newest-first, and an edit should land on the most
    // recently saved of two rows that share a URL.
    index[key] ??= {
      id: bookmark.id,
      title: bookmark.title,
      notes: bookmark.notes,
      tags: bookmark.tags,
      collectionId: bookmark.collectionId,
      createdAt: bookmark.createdAt,
      raw: bookmark.raw,
    };
  }
  return index;
}

async function rebuild(session: Session, seq: number): Promise<Cache> {
  const listing = await listVault(session);
  return {
    manifestSeq: seq,
    collections: sortCollections(listing.bookmarkCollections),
    bookmarksEnabled: listing.accountSettings.features.bookmarks,
    urlIndex: buildIndex(listing.bookmarks),
  };
}

/**
 * The cache, refreshed only when the vault has moved on.
 *
 * Returns the cache and whether a full listing had to be run, which the caller
 * uses to decide if the default collection still needs creating.
 */
export async function readCache(
  session: Session,
  password: string,
): Promise<{ cache: Cache; listed: boolean }> {
  const { seq } = await manifestState(session);
  const cached = await loadCache<Cache>(password);
  if (cached && cached.manifestSeq === seq && Array.isArray(cached.collections)) {
    return { cache: cached, listed: false };
  }
  const cache = await rebuild(session, seq);
  await saveCache(password, cache);
  return { cache, listed: true };
}

/**
 * Folds a just-written bookmark into the cache.
 *
 * The write's own sequence is already known, so this costs no request: the
 * alternative is invalidating the cache and paying a `listVault` on the next
 * popup open for a change this process made.
 */
export async function recordSave(
  password: string,
  cache: Cache,
  seq: number,
  entry: IndexEntry,
  url: string,
): Promise<Cache> {
  const key = normalizeUrl(url);
  const next: Cache = {
    ...cache,
    manifestSeq: seq,
    urlIndex: key ? { ...cache.urlIndex, [key]: entry } : cache.urlIndex,
  };
  await saveCache(password, next);
  return next;
}

export async function recordCollections(
  password: string,
  cache: Cache,
  collections: BookmarkCollection[],
): Promise<Cache> {
  const next: Cache = { ...cache, collections: sortCollections(collections) };
  await saveCache(password, next);
  return next;
}

export function defaultCollectionId(cache: Cache): string {
  return (
    cache.collections.find((collection) => collection.id === DEFAULT_BOOKMARK_COLLECTION_ID)?.id ??
    cache.collections[0]?.id ??
    DEFAULT_BOOKMARK_COLLECTION_ID
  );
}
