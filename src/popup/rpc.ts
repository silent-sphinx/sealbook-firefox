import type { Request, Response } from "../shared/messages";
import { ext } from "../shared/runtime";

/**
 * One call to the background page.
 *
 * Every refusal comes back as `{ok: false, error}` rather than as a rejected
 * promise, so the message the user sees is the one the background wrote.
 */
export async function send(request: Request): Promise<Response> {
  try {
    return (await ext().runtime.sendMessage(request)) as Response;
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "The extension's background page did not answer.",
    };
  }
}
