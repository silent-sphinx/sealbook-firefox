// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Request, Response } from "../shared/messages";
import "../test/dom";
import { installExtensionStub, removeExtensionStub } from "../test/extension";

const sendMessage = vi.fn<(...args: never[]) => Promise<unknown>>();
const query = vi.fn<(...args: never[]) => Promise<unknown[]>>();

/** The replies the background gives for an unlocked device over a saveable tab. */
function unlocked(): (request: Request) => Response {
  return (request) => {
    switch (request.kind) {
      case "status":
        return {
          ok: true,
          kind: "status",
          status: {
            lockState: "unlocked",
            account: { server: "https://127.0.0.1:8443", username: "alice" },
          },
        };
      case "lookup":
        return {
          ok: true,
          kind: "lookup",
          lookup: {
            collections: [{ id: "c-default", name: "Default Collection", raw: "{}" }],
            defaultCollectionId: "c-default",
            bookmarksEnabled: true,
            deviceName: "Swift Otter",
          },
        };
      case "save":
        return { ok: true, kind: "save", id: "b1" };
      default:
        return { ok: true, kind: "done" };
    }
  };
}

function answerWith(reply: (request: Request) => Response): void {
  sendMessage.mockImplementation((request: never) =>
    Promise.resolve(reply(request as unknown as Request)),
  );
}

beforeEach(() => {
  const stub = installExtensionStub() as unknown as { runtime: unknown; tabs: unknown };
  stub.runtime = { sendMessage };
  stub.tabs = { query, create: async () => ({}) };
  sendMessage.mockReset();
  query.mockReset();
  query.mockResolvedValue([{ url: "https://example.com/article", title: "An article" }]);
  answerWith(unlocked());
});

afterEach(() => {
  removeExtensionStub();
});

const { Popup } = await import("./Popup");

function sentKinds(): string[] {
  return sendMessage.mock.calls.map((call) => (call[0] as unknown as Request).kind);
}

describe("the popup", () => {
  it("opens on the save form for an unlocked device", async () => {
    render(<Popup />);

    expect(await screen.findByRole("button", { name: "Save" })).toBeTruthy();
    expect(screen.getByText("alice at https://127.0.0.1:8443")).toBeTruthy();
  });

  it("shows the name this extension goes by on the account's device list", async () => {
    render(<Popup />);
    expect(await screen.findByText("This device: Swift Otter")).toBeDefined();
  });

  it("locks on demand, which drops the keys and leaves the device enrolled", async () => {
    render(<Popup />);
    fireEvent.click(await screen.findByRole("button", { name: "Lock" }));

    await waitFor(() => expect(sentKinds()).toContain("lock"));
    // The reload after it is what shows the password screen, so the state the
    // user is left in comes from the background rather than from this component.
    expect(sentKinds().filter((kind) => kind === "status").length).toBeGreaterThan(1);
  });

  it("confirms before signing out, and does not unpair on the first click", async () => {
    render(<Popup />);
    fireEvent.click(await screen.findByRole("button", { name: "Sign out…" }));

    expect(screen.getByText(/removes this extension's keys/u)).toBeTruthy();
    expect(sentKinds()).not.toContain("unpair");

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Sign out…" })).toBeTruthy());
    expect(sentKinds()).not.toContain("unpair");
  });

  it("unpairs once confirmed", async () => {
    render(<Popup />);
    fireEvent.click(await screen.findByRole("button", { name: "Sign out…" }));
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));

    await waitFor(() => expect(sentKinds()).toContain("unpair"));
  });

  it("offers a way out of the password screen, for a password that is not coming back", async () => {
    answerWith((request) =>
      request.kind === "status"
        ? { ok: true, kind: "status", status: { lockState: "locked" } }
        : { ok: true, kind: "done" },
    );
    render(<Popup />);

    expect(await screen.findByRole("button", { name: "Unlock" })).toBeTruthy();
    // Nothing to lock from here, so only the one control.
    expect(screen.queryByRole("button", { name: "Lock" })).toBeNull();
    expect(screen.getByRole("button", { name: "Sign out…" })).toBeTruthy();
  });

  it("reports a refusal with the background's own message, and retries", async () => {
    answerWith(() => ({ ok: false, error: "The server could not be reached." }));
    render(<Popup />);

    expect(await screen.findByText("The server could not be reached.")).toBeTruthy();
    answerWith(unlocked());
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByRole("button", { name: "Save" })).toBeTruthy();
  });

  it("does not sit on the spinner when the reply is of a kind it cannot read", async () => {
    answerWith(() => ({ ok: true, kind: "done" }));
    render(<Popup />);

    expect(await screen.findByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("confirms a save and offers the saved bookmark for editing", async () => {
    render(<Popup />);
    fireEvent.click(await screen.findByRole("button", { name: "Save" }));

    expect(await screen.findByText("Saved to Sealbook.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Edit it" }));
    expect(await screen.findByRole("button", { name: "Save" })).toBeTruthy();
  });

  it("says so rather than showing a form when the page has no saveable address", async () => {
    query.mockResolvedValue([{ url: "about:config", title: "Config" }]);
    render(<Popup />);

    expect(await screen.findByText("This page has no address Sealbook can save.")).toBeTruthy();
    expect(sentKinds()).not.toContain("lookup");
  });
});
