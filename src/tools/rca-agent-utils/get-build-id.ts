import { getRegionalHost } from "../../lib/regional-host.js";

export async function getBuildId(
  projectName: string,
  buildName: string,
  username: string,
  accessKey: string,
): Promise<string> {
  const host = getRegionalHost("automationApi");
  const url = new URL(`${host}/ext/v1/builds/latest`);
  url.searchParams.append("project_name", projectName);
  url.searchParams.append("build_name", buildName);
  url.searchParams.append("user_name", username);

  const authHeader =
    "Basic " + Buffer.from(`${username}:${accessKey}`).toString("base64");

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(
      `Failed to fetch build ID: ${response.status} ${response.statusText}`,
    );
  }

  const data = await response.json();
  return data.build_id;
}
