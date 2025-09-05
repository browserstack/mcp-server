export async function getBuildId(
  projectName: string,
  buildName: string,
  username: string,
  accessKey: string,
): Promise<string> {
  const url = new URL(
    "https://api-automation.browserstack.com/ext/v1/builds/latest",
  );
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
