import { isValidUrl } from "@sealbook/lib/bookmark";
import { ext } from "../shared/runtime";

export type PageRef = { url: string; title: string };

/**
 * The page the popup was opened over.
 *
 * `activeTab` is enough for `url` and `title`; the broad `tabs` permission would
 * expose every tab and is not asked for. Nothing fetches the URL: resolving a
 * saved address would tell the site in it that this account holds it.
 */
export async function activePage(): Promise<PageRef | null> {
  const [tab] = await ext().tabs.query({ active: true, currentWindow: true });
  const url = tab?.url ?? "";
  if (!isValidUrl(url)) return null;
  return { url, title: tab?.title?.trim() || url };
}
