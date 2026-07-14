import { apiClient } from "../../lib/apiClient.js";

/**
 * Returns the latest build for a project + build name across all users (not just the caller's).
 */
export async function listBuildId(
  projectName: string,
  buildName: string,
  username: string,
  accessKey: string,
): Promise<string> {
  const authHeader =
    "Basic " + Buffer.from(`${username}:${accessKey}`).toString("base64");

  const response = await apiClient.get({
    url: "https://api-automation.browserstack.com/ext/v1/builds/latest",
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/json",
    },
    params: {
      project_name: projectName,
      build_name: buildName,
    },
  });

  const buildId = response.data?.build_id;
  if (!buildId) {
    throw new Error(
      `No build found for project "${projectName}" and build "${buildName}"`,
    );
  }
  return buildId;
}
