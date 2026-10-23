import { newBookmarkId, putBookmark, type Session } from "@sealbook/lib";
import {
  bookmarkFitsObjectLimit,
  isValidUrl,
  normalizeUrl,
  resolveCollectionId,
  serializeBookmark,
} from "@sealbook/lib/bookmark";
import type { BookmarkDraft } from "@sealbook/lib/types";
import { recordSave, type Cache, type IndexEntry } from "./collections";

export class DraftRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DraftRejected";
  }
}

function entryOf(id: string, draft: BookmarkDraft, raw: string): IndexEntry {
  return {
    id,
    title: draft.title.trim(),
    notes: draft.notes,
    tags: draft.tags,
    collectionId: resolveCollectionId(draft.collectionId),
    createdAt: draft.createdAt,
    raw,
  };
}

/**
 * Seals a bookmark and folds it into the cache.
 *
 * Runs in the background rather than the popup for two reasons: the popup is
 * destroyed the moment it loses focus, which would cut a manifest-signing write
 * off mid-commit, and `serializeVault` is a module-level queue in one JS realm,
 * so writing from both realms means two independent queues against one
 * collection.
 */
export async function saveBookmark(
  session: Session,
  password: string,
  cache: Cache,
  draft: BookmarkDraft,
  existingId?: string,
): Promise<{ id: string; cache: Cache }> {
  if (!isValidUrl(draft.url)) {
    throw new DraftRejected("That page has no address Sealbook can save.");
  }
  // Checked before any crypto: past the limit the server answers 400, and
  // sealing and signing first would be work thrown away.
  if (!bookmarkFitsObjectLimit(draft)) {
    throw new DraftRejected("This bookmark is too large to store. Shorten the note.");
  }

  const id = existingId ?? newBookmarkId();
  await putBookmark(session, draft, id);

  // Serialized a second time for the cache's `raw`, which the next edit merges
  // onto. The two differ only in `updatedAt`, which every save rewrites anyway;
  // what matters is that the unknown keys `mergePayload` carried are in it.
  const raw = serializeBookmark(draft);
  // The sequence the write advanced to. Read from the session rather than
  // re-fetched: `putSealed` has already accepted the manifest it committed.
  const next = await recordSave(
    password,
    cache,
    session.manifestSeq,
    entryOf(id, draft, raw),
    draft.url,
  );
  return { id, cache: next };
}

/**
 * The draft an edit of an already-saved URL starts from.
 *
 * `draft.raw` is the previous payload and must be carried: `serializeBookmark`
 * feeds it to `mergePayload`, so without it every key written by a newer client
 * is destroyed. `createdAt` is carried for the same reason it exists.
 */
export function draftFromEntry(entry: IndexEntry, url: string): BookmarkDraft {
  return {
    url: normalizeUrl(url),
    title: entry.title,
    notes: entry.notes,
    tags: entry.tags ?? [],
    collectionId: resolveCollectionId(entry.collectionId),
    createdAt: entry.createdAt,
    raw: entry.raw,
  };
}
