import { describe, expect, it } from "vitest";
import { isRequest } from "./messages";

const draft = { url: "https://example.com", title: "Example", collectionId: "c1" };

describe("the request guard", () => {
  it("accepts the no-payload requests", () => {
    for (const kind of [
      "status",
      "lock",
      "pairingStatus",
      "cancelPairing",
      "openPairingTab",
    ]) {
      expect(isRequest({ kind })).toBe(true);
    }
  });

  it("rejects anything that is not a tagged object", () => {
    for (const value of [null, undefined, 7, "status", [], {}, { kind: 1 }]) {
      expect(isRequest(value)).toBe(false);
    }
  });

  it("rejects a kind it does not know", () => {
    expect(isRequest({ kind: "rotateEverything" })).toBe(false);
  });

  it("insists on a non-empty password, which is the whole of an unlock", () => {
    expect(isRequest({ kind: "unlock", password: "pw" })).toBe(true);
    expect(isRequest({ kind: "unlock", password: "" })).toBe(false);
    expect(isRequest({ kind: "unlock" })).toBe(false);
  });

  it("accepts a well-formed save, with or without an existing id", () => {
    expect(isRequest({ kind: "save", draft })).toBe(true);
    expect(isRequest({ kind: "save", draft, existingId: "b1" })).toBe(true);
    expect(
      isRequest({
        kind: "save",
        draft: { ...draft, tags: ["a", "b"], notes: "why", raw: "{}", createdAt: "2026-01-01" },
      }),
    ).toBe(true);
  });

  it("rejects a half-formed draft, which must not reach putSealed", () => {
    // Each of these would otherwise be sealed and signed before anything
    // noticed, because the server never sees a bookmark's shape.
    expect(isRequest({ kind: "save", draft: { ...draft, url: 7 } })).toBe(false);
    expect(isRequest({ kind: "save", draft: { ...draft, title: undefined } })).toBe(false);
    expect(isRequest({ kind: "save", draft: { ...draft, collectionId: null } })).toBe(false);
    expect(isRequest({ kind: "save", draft: { ...draft, tags: "a,b" } })).toBe(false);
    expect(isRequest({ kind: "save", draft: { ...draft, tags: ["a", 2] } })).toBe(false);
    expect(isRequest({ kind: "save", draft: { ...draft, raw: {} } })).toBe(false);
    expect(isRequest({ kind: "save", draft, existingId: 5 })).toBe(false);
    expect(isRequest({ kind: "save" })).toBe(false);
  });
});
