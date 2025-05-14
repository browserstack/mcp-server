import config from "../config";

export async function getLatestO11YBuildInfo(
  buildName: string,
  projectName: string,
) {
  const buildsUrl = `https://api-observability.browserstack.com/ext/v1/builds/latest?build_name=${encodeURIComponent(
    buildName,
  )}&project_name=${encodeURIComponent(projectName)}`;

  const buildsResponse = await fetch(buildsUrl, {
    headers: {
      Authorization: `Basic ${Buffer.from(
        `${config.browserstackUsername}:${config.browserstackAccessKey}`,
      ).toString("base64")}`,
    },
  });

  if (!buildsResponse.ok) {
    if (buildsResponse.statusText === "Unauthorized") {
      throw new Error(
        `Failed to fetch builds: ${buildsResponse.statusText}. Please check if the BrowserStack credentials are correctly configured when installing the MCP server.`,
      );
    }
    throw new Error(`Failed to fetch builds: ${buildsResponse.statusText}`);
  }

  return buildsResponse.json();
}
