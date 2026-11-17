import { createHash } from "crypto";
import { PercyIntegrationTypeEnum } from "../common/types.js";
import { CallerError } from "../../../lib/error.js";
import { trackedFetch } from "../../../lib/upstream-status.js";

const tokenCache = new Map<string, string>();

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
  const response = await trackedFetch(url, {
    headers: { Authorization: authHeader },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch Percy token (status: ${response.status})`);
  }

  const data = await response.json();

  if (!data?.token || !data?.success) {
    throw new CallerError(
      "Project exists but is likely set up for Automate. Please use a different project name.",
    );
  }

  return data.token;
}

function tokenCacheKey(
  projectName: string,
  authorization: string,
  type?: PercyIntegrationTypeEnum,
): string {
  return createHash("sha256")
    .update(`${authorization}\u0000${projectName}\u0000${type ?? ""}`)
    .digest("hex");
}

export async function fetchPercyToken(
  projectName: string,
  authorization: string,
  options: { type?: PercyIntegrationTypeEnum } = {},
): Promise<string> {
  const key = tokenCacheKey(projectName, authorization, options.type);
  const cached = tokenCache.get(key);
  if (cached) {
    return cached;
  }

  const token = await fetchTokenFromAPI(projectName, authorization, options);
  tokenCache.set(key, token);
  return token;
}
