/**
 * Shared setup for the component suites. Importing this module is what a
 * `@vitest-environment jsdom` test file needs; the logic suites run under node
 * and must not pull it in.
 */
import { afterEach } from "vitest";
import { cleanup, configure } from "@testing-library/react";

// Headroom against the machine, not the app: these suites run alongside PBKDF2
// derivations at 600,000 iterations, and the default 1,000 ms is too tight.
configure({ asyncUtilTimeout: 4000 });

afterEach(() => {
  cleanup();
});
