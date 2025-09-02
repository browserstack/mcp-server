import { getBrowserStackAuth } from "../../lib/get-auth.js";
import { BrowserStackConfig } from "../../lib/types.js";
import { sanitizeUrlParam } from "../../lib/utils.js";

// Utility for fetching only the IDs of changed Percy snapshots for a given build.
export async function getChangedPercySnapshotIds(
  buildId: string,
  config: BrowserStackConfig,
  orgId: string | undefined,
  browserIds: string[],
): Promise<string[]> {
  if (!buildId || !orgId) {
    throw new Error(
      "Failed to fetch AI Summary: Missing build ID or organization ID",
    );
  }

  const urlStr = constructPercyBuildItemsUrl({
    buildId,
    orgId,
    category: ["changed"],
    subcategories: ["unreviewed", "approved", "changes_requested"],
    groupSnapshotsBy: "similar_diff",
    browserIds,
    widths: ["375", "1280", "1920"],
  });

  const authString = getBrowserStackAuth(config);
  const auth = Buffer.from(authString).toString("base64");
  const response = await fetch(urlStr, {
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(
      `Failed to fetch changed Percy snapshots: ${response.status} ${response.statusText}`,
    );
  }

  const responseData = await response.json();
  const buildItems = responseData.data ?? [];

  if (buildItems.length === 0) {
    return [];
  }

  const snapshotIds = buildItems
    .flatMap((item: any) => item.attributes?.["snapshot-ids"] ?? [])
    .map((id: any) => String(id));

  return snapshotIds;
}

export function constructPercyBuildItemsUrl({
  buildId,
  orgId,
  category = [],
  subcategories = [],
  browserIds = [],
  widths = [],
  groupSnapshotsBy,
}: {
  buildId: string;
  orgId: string;
  category?: string[];
  subcategories?: string[];
  browserIds?: string[];
  widths?: string[];
  groupSnapshotsBy?: string;
}): string {
  const url = new URL("https://percy.io/api/v1/build-items");
  url.searchParams.set("filter[build-id]", sanitizeUrlParam(buildId));
  url.searchParams.set("filter[organization-id]", sanitizeUrlParam(orgId));

  if (category && category.length > 0) {
    category.forEach((cat) =>
      url.searchParams.append("filter[category][]", sanitizeUrlParam(cat)),
    );
  }
  if (subcategories && subcategories.length > 0) {
    subcategories.forEach((sub) =>
      url.searchParams.append("filter[subcategories][]", sanitizeUrlParam(sub)),
    );
  }
  if (browserIds && browserIds.length > 0) {
    browserIds.forEach((id) =>
      url.searchParams.append("filter[browser_ids][]", sanitizeUrlParam(id)),
    );
  }
  if (widths && widths.length > 0) {
    widths.forEach((w) =>
      url.searchParams.append("filter[widths][]", sanitizeUrlParam(w)),
    );
  }
  if (groupSnapshotsBy) {
    url.searchParams.set(
      "filter[group_snapshots_by]",
      sanitizeUrlParam(groupSnapshotsBy),
    );
  }
  return url.toString();
}
