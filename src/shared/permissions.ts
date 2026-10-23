import { normalizeServer } from "@sealbook/lib";
import { ext } from "./runtime";

/**
 * The match pattern covering a server's origin.
 *
 * A match pattern has no port component, so a URL's port is dropped rather than
 * passed through: `https://localhost:8443/*` is rejected as malformed and the
 * `permissions` call throws. Granting the host grants it on every port.
 */
export function hostPattern(server: string): string {
  const url = new URL(normalizeServer(server));
  return `${url.protocol}//${url.hostname}/*`;
}

/**
 * Asks for the host permission the server needs.
 *
 * A self-hosted server's host is not known at build time, so it cannot be in
 * `host_permissions`; it is requested once, when the user names their domain.
 * `permissions.request` must be called from a user gesture in an extension page,
 * which is why this lives on the pairing form rather than in the background, and
 * why nothing is awaited before it: an await ends the gesture and Firefox then
 * refuses the call. A permission already held resolves true with no prompt, so
 * `contains` is not consulted first.
 */
export function ensureHostPermission(server: string): Promise<boolean> {
  return ext().permissions.request({ origins: [hostPattern(server)] });
}
