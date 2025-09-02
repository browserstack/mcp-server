import logger from "../logger.js";
import { BrowserStackConfig } from "../lib/types.js";
import { getBrowserStackAuth } from "../lib/get-auth.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { getPercyBuildCount } from "./review-agent-utils/build-counts.js";
import { getChangedPercySnapshotIds } from "./review-agent-utils/percy-snapshots.js";
import { PercyIntegrationTypeEnum } from "./sdk-utils/common/types.js";
import { fetchPercyToken } from "./sdk-utils/percy-web/fetchPercyToken.js";

import {
  getPercySnapshotDiffs,
  PercySnapshotDiff,
} from "./review-agent-utils/percy-diffs.js";

export async function fetchPercyChanges(
  args: { project_name: string },
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  const { project_name } = args;
  const authorization = getBrowserStackAuth(config);

  // Get Percy token for the project
  const percyToken = await fetchPercyToken(project_name, authorization, {
    type: PercyIntegrationTypeEnum.WEB,
  });

  // Get build info (noBuilds, isFirstBuild, lastBuildId)
  const { noBuilds, isFirstBuild, lastBuildId, orgId, browserIds } =
    await getPercyBuildCount(percyToken);

  if (noBuilds) {
    return {
      content: [
        {
          type: "text",
          text: "No Percy builds found. Please run your first Percy scan to start visual testing.",
        },
      ],
    };
  }

  if (isFirstBuild || !lastBuildId) {
    return {
      content: [
        {
          type: "text",
          text: "This is the first Percy build. No baseline exists to compare changes.",
        },
      ],
    };
  }

  // Get snapshot IDs for the latest build
  const snapshotIds = await getChangedPercySnapshotIds(
    lastBuildId,
    config,
    orgId,
    browserIds,
  );
  logger.info(
    `Fetched ${snapshotIds.length} snapshot IDs for build: ${lastBuildId} as ${snapshotIds.join(", ")}`,
  );

  // Fetch all diffs concurrently and flatten results
  const allDiffs = await getPercySnapshotDiffs(snapshotIds, percyToken);

  if (allDiffs.length === 0) {
    return {
      content: [
        {
          type: "text",
          text: "AI Summary is not yet available for this build/framework. There may still be visual changes—please review the build on the dashboard.",
        },
      ],
    };
  }

  return {
    content: allDiffs.map((diff: PercySnapshotDiff) => ({
      type: "text",
      text: `${diff.name} → ${diff.title}: ${diff.description ?? ""}`,
    })),
  };
}
