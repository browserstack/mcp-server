export interface PercySnapshotDiff {
  id: string;
  name: string | null;
  title: string;
  description: string | null;
  coordinates: any;
}

export async function getPercySnapshotDiff(
  snapshotId: string,
  percyToken: string,
): Promise<PercySnapshotDiff[]> {
  const apiUrl = `https://percy.io/api/v1/snapshots/${snapshotId}`;

  const response = await fetch(apiUrl, {
    headers: {
      Authorization: `Token token=${percyToken}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(
      `Failed to fetch Percy snapshot ${snapshotId}: ${response.statusText}`,
    );
  }

  const data = await response.json();
  const pageUrl = data.data.attributes?.name || null;

  const changes: PercySnapshotDiff[] = [];
  const comparisons =
    data.included?.filter((item: any) => item.type === "comparisons") ?? [];

  for (const comparison of comparisons) {
    const appliedRegions = comparison.attributes?.["applied-regions"] ?? [];
    for (const region of appliedRegions) {
      if (region.ignored) continue;
      changes.push({
        id: String(region.id),
        name: pageUrl,
        title: region.change_title,
        description: region.change_description ?? null,
        coordinates: region.coordinates ?? null,
      });
    }
  }

  return changes;
}

export async function getPercySnapshotDiffs(
  snapshotIds: string[],
  percyToken: string,
): Promise<PercySnapshotDiff[]> {
  const allDiffs = await Promise.all(
    snapshotIds.map((id) => getPercySnapshotDiff(id, percyToken)),
  );
  return allDiffs.flat();
}
