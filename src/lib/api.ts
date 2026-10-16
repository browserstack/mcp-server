import { getBrowserStackAuth } from "./get-auth.js";
import { BrowserStackConfig } from "../lib/types.js";
import { apiClient } from "./apiClient.js";
import { getRegionalHost } from "./regional-host.js";

export async function getLatestO11YBuildInfo(
  buildName: string,
  projectName: string,
  config: BrowserStackConfig,
) {
  const host = await getRegionalHost("observabilityApi", config);
  const buildsUrl = `${host}/ext/v1/builds/latest?build_name=${encodeURIComponent(
    buildName,
  )}&project_name=${encodeURIComponent(projectName)}`;

  const authString = getBrowserStackAuth(config);
  const auth = Buffer.from(authString).toString("base64");

  const buildsResponse = await apiClient.get({
    url: buildsUrl,
    headers: {
      Authorization: `Basic ${auth}`,
    },
    raise_error: false,
  });

  if (!buildsResponse.ok) {
    if (buildsResponse.statusText === "Unauthorized") {
      throw new Error(
        `Failed to fetch builds: ${buildsResponse.statusText}. Please check if the BrowserStack credentials are correctly configured when installing the MCP server.`,
      );
    }
    throw new Error(`Failed to fetch builds: ${buildsResponse.statusText}`);
  }

  return buildsResponse;
}
