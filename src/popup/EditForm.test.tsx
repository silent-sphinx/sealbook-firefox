// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { BookmarkDraft } from "@sealbook/lib/types";
import "../test/dom";
import { installExtensionStub, removeExtensionStub } from "../test/extension";

const sendMessage = vi.fn<(...args: never[]) => Promise<unknown>>();

beforeEach(() => {
  const stub = installExtensionStub() as unknown as { runtime: unknown };
  stub.runtime = { sendMessage };
  sendMessage.mockReset();
  sendMessage.mockResolvedValue({ ok: true, kind: "save", id: "b1" });
});

afterEach(() => {
  removeExtensionStub();
});

const { EditForm } = await import("./EditForm");

const collections = [
  { id: "c-default", name: "Default Collection", raw: "{}" },
  { id: "c-reading", name: "Reading", raw: "{}" },
];

function draft(overrides: Partial<BookmarkDraft> = {}): BookmarkDraft {
  return {
    url: "https://example.com/article",
    title: "An article",
    collectionId: "c-default",
    tags: [],
    ...overrides,
  };
}

describe("the save form", () => {
  it("prefills the page's title and URL", () => {
    render(<EditForm draft={draft()} collections={collections} onSaved={() => {}} />);

    expect(screen.getByLabelText("Title")).toHaveProperty("value", "An article");
    expect(screen.getByText("https://example.com/article")).toBeTruthy();
  });

  it("sends the edited fields, with tags split on commas", async () => {
    render(<EditForm draft={draft()} collections={collections} onSaved={() => {}} />);

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Renamed" } });
    fireEvent.change(screen.getByLabelText("Collection"), { target: { value: "c-reading" } });
    fireEvent.change(screen.getByLabelText("Tags"), { target: { value: " rust , , crypto " } });
    fireEvent.change(screen.getByLabelText("Note"), { target: { value: "  why  " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(sendMessage).toHaveBeenCalled());
    expect(sendMessage.mock.calls[0]?.[0]).toEqual({
      kind: "save",
      draft: {
        url: "https://example.com/article",
        title: "Renamed",
        collectionId: "c-reading",
        tags: ["rust", "crypto"],
        notes: "why",
      },
      existingId: undefined,
    });
  });

  it("carries raw and createdAt through an edit, which is the merge guarantee", async () => {
    const existing = draft({
      raw: '{"url":"https://example.com/article","somethingNewer":true}',
      createdAt: "2026-01-01T00:00:00.000Z",
      tags: ["rust"],
      notes: "earlier note",
    });
    render(
      <EditForm
        draft={existing}
        collections={collections}
        existingId="b1"
        onSaved={() => {}}
      />,
    );

    // The form shows Update, not Save: this URL is already in the vault.
    fireEvent.click(screen.getByRole("button", { name: "Update" }));

    await waitFor(() => expect(sendMessage).toHaveBeenCalled());
    const sent = sendMessage.mock.calls[0]?.[0] as {
      existingId: string;
      draft: BookmarkDraft;
    };
    expect(sent.existingId).toBe("b1");
    expect(sent.draft.raw).toContain("somethingNewer");
    expect(sent.draft.createdAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("shows the background's own message when a save is refused", async () => {
    sendMessage.mockResolvedValue({ ok: false, error: "This bookmark is too large to store." });
    render(<EditForm draft={draft()} collections={collections} onSaved={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("This bookmark is too large to store.")).toBeTruthy();
  });

  it("reports the save to its caller only once the background confirms it", async () => {
    const onSaved = vi.fn<(id: string) => void>();
    render(<EditForm draft={draft()} collections={collections} onSaved={onSaved} />);

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith("b1"));
  });
});
