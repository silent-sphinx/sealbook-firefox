import { useState, type FormEvent } from "react";
import type { BookmarkCollection, BookmarkDraft } from "@sealbook/lib/types";
import { send } from "./rpc";

/**
 * The save form.
 *
 * It submits to the background page and hands the id to its caller. The write
 * itself runs there, so a popup dismissed the instant after Save does not abort
 * a manifest-signing write half way through.
 */
export function EditForm({
  draft,
  collections,
  existingId,
  onSaved,
}: {
  draft: BookmarkDraft;
  collections: BookmarkCollection[];
  existingId?: string;
  onSaved: (id: string) => void;
}) {
  const [title, setTitle] = useState(draft.title);
  const [collectionId, setCollectionId] = useState(draft.collectionId);
  const [tags, setTags] = useState((draft.tags ?? []).join(", "));
  const [notes, setNotes] = useState(draft.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const response = await send({
      kind: "save",
      // `raw` and `createdAt` ride along untouched: they are what makes an edit
      // a merge onto the stored payload rather than a replacement of it.
      draft: {
        ...draft,
        title,
        collectionId,
        tags: tags
          .split(",")
          .map((tag) => tag.trim())
          .filter((tag) => tag.length > 0),
        notes: notes.trim() || undefined,
      },
      existingId,
    });
    setBusy(false);
    if (!response.ok) {
      setError(response.error);
      return;
    }
    if (response.kind === "save") onSaved(response.id);
  }

  return (
    <form onSubmit={onSubmit}>
      <h1>{existingId ? "Update bookmark" : "Save to Sealbook"}</h1>
      <p className="host">{draft.url}</p>
      <label>
        Title
        <input value={title} autoFocus onChange={(event) => setTitle(event.target.value)} />
      </label>
      <label>
        Collection
        <select value={collectionId} onChange={(event) => setCollectionId(event.target.value)}>
          {collections.map((collection) => (
            <option key={collection.id} value={collection.id}>
              {collection.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Tags
        <input
          value={tags}
          placeholder="comma, separated"
          onChange={(event) => setTags(event.target.value)}
        />
      </label>
      <label>
        Note
        <textarea value={notes} onChange={(event) => setNotes(event.target.value)} />
      </label>
      <button type="submit" disabled={busy}>
        {busy ? "Saving…" : existingId ? "Update" : "Save"}
      </button>
      {error ? <p className="error">{error}</p> : null}
    </form>
  );
}
