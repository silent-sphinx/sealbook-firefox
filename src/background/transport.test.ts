import { describe, expect, it, vi } from "vitest";

/**
 * The one transport setting this extension has to change, pinned to the module
 * that does it rather than to a call order.
 *
 * `@sealbook/lib` is mocked only to keep the real `transport.ts` while leaving
 * the crypto module out of this suite; `setProxyLoopback` and `apiRoot` are the
 * genuine ones, so this fails if the call moves back behind a lazy path.
 */
vi.mock("@sealbook/lib", async () => {
  const transport = await import("@sealbook/lib/transport");
  return {
    ApiError: transport.ApiError,
    loginAccount: () => Promise.reject(new Error("not used")),
    setProxyLoopback: transport.setProxyLoopback,
  };
});
vi.mock("@sealbook/lib/wasm", () => ({
  initWasm: async () => {},
  protocolVersion: () => "unused",
  payloadSchemaVersion: () => "unused",
}));

// Importing it is the whole point: nothing here calls into it.
await import("./session");
const { apiRoot } = await import("@sealbook/lib/transport");

describe("the loopback proxy", () => {
  it("is off by the time the background module is imported", () => {
    // The default collapses these two to "" for sealbook-web's Vite proxy. In an
    // extension that is a request against moz-extension://<uuid>/, which fails
    // as "The server could not be reached." The unlock path used to reach the
    // network before anything had turned this off, so a paired extension could
    // not get past its own lock screen after a restart.
    expect(apiRoot("https://127.0.0.1:8443")).toBe("https://127.0.0.1:8443");
    expect(apiRoot("https://localhost:8443")).toBe("https://localhost:8443");
  });

  it("leaves any other server untouched", () => {
    expect(apiRoot("https://vault.example.com")).toBe("https://vault.example.com");
  });
});
