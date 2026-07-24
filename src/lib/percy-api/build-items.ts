/**
 * Shared helpers for the /build-items endpoint.
 *
 * Pagination: the API returns everything when page[limit] is omitted, but may
 * still paginate (meta.pagination.has_more + next_cursor) on very large
 * builds or if server-side defaults change. fetchAllBuildItems handles both:
 * it starts with an unbounded request and follows next_cursor if the response
 * is paginated anyway.
 */

import { percyGet } from "./percy-auth.js";
import { BrowserStackConfig } from "../types.js";

const MAX_PAGES = 50;

export interface BuildItemsResult {
  items: any[];
  /** True if pagination could not be exhausted (page cap or cursor stall). */
  truncated: boolean;
}

/**
 * Fetch ALL build items for the given filters, following
 * meta.pagination.next_cursor until has_more is false.
 */
export async function fetchAllBuildItems(
  config: BrowserStackConfig,
  baseParams: Record<string, string | string[]>,
): Promise<BuildItemsResult> {
  const items: any[] = [];
  let cursor: string | undefined;
  let pages = 0;

  for (;;) {
    const params: Record<string, string | string[]> = { ...baseParams };
    if (cursor) params["page[cursor]"] = cursor;

    const response = await percyGet("/build-items", config, params);
    items.push(...(response?.data || []));
    pages += 1;

    const pagination = response?.meta?.pagination;
    const nextCursor = pagination?.next_cursor;
    if (!pagination?.has_more || !nextCursor) {
      return { items, truncated: false };
    }
    // Guard against a stalled cursor or runaway loop.
    if (nextCursor === cursor || pages >= MAX_PAGES) {
      return { items, truncated: true };
    }
    cursor = String(nextCursor);
  }
}

/**
 * Filter params that make filter[category]=changed actually return results.
 * The API only maps the changed category to review states via
 * filter[subcategories][]; without it the scope resolves to zero rows.
 */
export const CHANGED_CATEGORY_PARAMS: Record<string, string | string[]> = {
  "filter[category]": "changed",
  "filter[subcategories][]": ["unreviewed", "changes_requested", "approved"],
};

/**
 * Format a 0..1 diff ratio as a percentage without hiding small diffs:
 * 0 → "0%", tiny → "<0.01%", otherwise two decimals (e.g. "0.02%").
 */
export function formatDiffPercent(ratio: number | null | undefined): string {
  if (ratio == null) return "—";
  const pct = ratio * 100;
  if (pct === 0) return "0%";
  if (pct < 0.01) return "<0.01%";
  return pct.toFixed(2) + "%";
}
