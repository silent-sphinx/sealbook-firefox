/**
 * A `Map`-backed stand-in for the extension APIs.
 *
 * Installed on `globalThis` so `shared/runtime.ext()` picks it up. The storage
 * areas behave as the real ones do in the way that matters here: `local`
 * persists across a simulated suspension, `session` does not.
 */
export type StorageStub = {
  get(keys?: string | string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
  clear(): Promise<void>;
  /** The backing store, for assertions about what was written. */
  store: Map<string, unknown>;
};

export function storageStub(): StorageStub {
  const store = new Map<string, unknown>();
  return {
    store,
    async get(keys) {
      if (keys === undefined || keys === null) return Object.fromEntries(store);
      const wanted = typeof keys === "string" ? [keys] : keys;
      const out: Record<string, unknown> = {};
      for (const key of wanted) {
        if (store.has(key)) out[key] = store.get(key);
      }
      return out;
    },
    async set(items) {
      for (const [key, value] of Object.entries(items)) {
        // Round-tripped through JSON, as the real area does: a value that
        // cannot be serialized must fail here rather than in the browser.
        store.set(key, JSON.parse(JSON.stringify(value)) as unknown);
      }
    },
    async remove(keys) {
      for (const key of typeof keys === "string" ? [keys] : keys) store.delete(key);
    },
    async clear() {
      store.clear();
    },
  };
}

export type ExtensionStub = {
  storage: { local: StorageStub; session: StorageStub };
  tabs: { query: () => Promise<unknown[]>; create: () => Promise<unknown> };
};

export function installExtensionStub(): ExtensionStub {
  const stub: ExtensionStub = {
    storage: { local: storageStub(), session: storageStub() },
    tabs: { query: async () => [], create: async () => ({}) },
  };
  (globalThis as { browser?: unknown }).browser = stub;
  return stub;
}

export function removeExtensionStub(): void {
  delete (globalThis as { browser?: unknown }).browser;
}
