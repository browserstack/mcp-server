import { PercyIntegrationTypeEnum } from "../common/types.js";

export async function fetchPercyToken(
  projectName: string,
  authorization: string,
  options: { type?: PercyIntegrationTypeEnum } = {},
): Promise<string> {
  try {
    const authHeader = `Basic ${Buffer.from(authorization).toString("base64")}`;
    const baseUrl =
      "https://api.browserstack.com/api/app_percy/get_project_token";
    const params = new URLSearchParams({ name: projectName });

    if (options.type) {
      params.append("type", options.type);
    }

    const url = `${baseUrl}?${params.toString()}`;

    const response = await fetch(url, {
      headers: {
        Authorization: authHeader,
      },
    });

    if (!response.ok) {
      throw new Error(
        `Failed to fetch Percy token (status: ${response.status})`,
      );
    }

    const data = await response.json();

    if (!data?.token || !data?.success) {
      throw new Error(
        "Project exists but is likely set up for Automate. Please use a different project name.",
      );
    }

    return data.token;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    throw new Error(`Error retrieving Percy token: ${message}`);
  }
}
