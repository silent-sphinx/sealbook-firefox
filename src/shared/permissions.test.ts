import { afterEach, describe, expect, it, vi } from "vitest";
import { ensureHostPermission, hostPattern } from "./permissions";

type PermissionsStub = {
  request: ReturnType<typeof vi.fn<(p: { origins: string[] }) => Promise<boolean>>>;
};

function installPermissions(request: boolean): PermissionsStub {
  const stub: PermissionsStub = {
    request: vi.fn<(p: { origins: string[] }) => Promise<boolean>>().mockResolvedValue(request),
  };
  (globalThis as { browser?: unknown }).browser = { permissions: stub };
  return stub;
}

afterEach(() => {
  delete (globalThis as { browser?: unknown }).browser;
});

describe("hostPattern", () => {
  it("drops the port, which a match pattern cannot carry", () => {
    expect(hostPattern("https://localhost:8443")).toBe("https://localhost/*");
    expect(hostPattern("https://127.0.0.1:8443")).toBe("https://127.0.0.1/*");
  });

  it("drops a path too", () => {
    expect(hostPattern("https://vault.example.com/sealbook")).toBe("https://vault.example.com/*");
  });

  it("rejects an address that is not a server", () => {
    expect(() => hostPattern("https://user:secret@example.com")).toThrow(
      "Connection domain cannot contain credentials.",
    );
  });
});

describe("ensureHostPermission", () => {
  it("requests the port-free pattern", async () => {
    const stub = installPermissions(true);
    await expect(ensureHostPermission("https://localhost:8443")).resolves.toBe(true);
    expect(stub.request).toHaveBeenCalledWith({ origins: ["https://localhost/*"] });
  });

  it("asks without awaiting anything first, so the click still counts", () => {
    const stub = installPermissions(true);
    void ensureHostPermission("https://localhost:8443");
    expect(stub.request).toHaveBeenCalledTimes(1);
  });

  it("reports a refusal", async () => {
    installPermissions(false);
    await expect(ensureHostPermission("https://localhost:8443")).resolves.toBe(false);
  });
});
