/**
 * The extension APIs, under one name.
 *
 * Firefox provides the promise-returning `browser` global; Chrome provides
 * `chrome`, whose MV3 surface returns promises too. Only the parts this
 * extension uses are typed, so a call this repo has no business making does not
 * typecheck.
 */
type StorageArea = {
  get(keys?: string | string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
  clear(): Promise<void>;
};

export type Tab = {
  id?: number;
  url?: string;
  title?: string;
};

type Browser = {
  storage: {
    local: StorageArea;
    session: StorageArea;
  };
  runtime: {
    id: string;
    getURL(path: string): string;
    sendMessage(message: unknown): Promise<unknown>;
    onMessage: {
      addListener(
        listener: (
          message: unknown,
          sender: unknown,
          respond: (response: unknown) => void,
        ) => boolean | void | Promise<unknown>,
      ): void;
    };
    onInstalled: { addListener(listener: () => void): void };
  };
  tabs: {
    query(info: { active?: boolean; currentWindow?: boolean }): Promise<Tab[]>;
    create(info: { url: string }): Promise<Tab>;
  };
  idle: {
    setDetectionInterval(seconds: number): void;
    onStateChanged: { addListener(listener: (state: string) => void): void };
  };
  permissions: {
    request(permissions: { origins: string[] }): Promise<boolean>;
  };
};

/**
 * Resolved per call rather than once at module load, so a suite can install a
 * stub on `globalThis` without fighting import hoisting.
 */
export function ext(): Browser {
  const scope = globalThis as { browser?: Browser; chrome?: Browser };
  const api = scope.browser ?? scope.chrome;
  if (!api) {
    throw new Error("no extension APIs: this module only runs inside the extension");
  }
  return api;
}
