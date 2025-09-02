import { PercyIntegrationTypeEnum } from "../common/types.js";

let globalPercyToken: string | null = null;
let globalProjectName: string | null = null;

async function fetchTokenFromAPI(
  projectName: string,
  authorization: string,
  options: { type?: PercyIntegrationTypeEnum } = {},
): Promise<string> {
  const authHeader = `Basic ${Buffer.from(authorization).toString("base64")}`;
  const baseUrl =
    "https://api.browserstack.com/api/app_percy/get_project_token";
  const params = new URLSearchParams({ name: projectName });

  if (options.type) {
    params.append("type", options.type);
  }

  const url = `${baseUrl}?${params.toString()}`;
  const response = await fetch(url, { headers: { Authorization: authHeader } });

  if (!response.ok) {
    throw new Error(`Failed to fetch Percy token (status: ${response.status})`);
  }

  const data = await response.json();

  if (!data?.token || !data?.success) {
    throw new Error(
      "Project exists but is likely set up for Automate. Please use a different project name.",
    );
  }

  return data.token;
}

export async function fetchPercyToken(
  projectName: string,
  authorization: string,
  options: { type?: PercyIntegrationTypeEnum } = {},
): Promise<string> {
  if (globalProjectName !== projectName) {
    globalProjectName = projectName;
    globalPercyToken = null;
  }

  if (globalPercyToken) {
    return globalPercyToken;
  }

  const token = await fetchTokenFromAPI(projectName, authorization, options);
  globalPercyToken = token;
  return token;
}
