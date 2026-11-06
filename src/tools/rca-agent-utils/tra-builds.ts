import { apiClient } from "../../lib/apiClient.js";
import { HttpError } from "../../lib/error.js";
import { getBrowserStackAuth } from "../../lib/get-auth.js";
import { BrowserStackConfig } from "../../lib/types.js";
import { getAutomationBaseUrl } from "./constants.js";

// TRA matches /builds/latest on `original_name`, the build name the SDK sent;
// the dashboard shows a shortened `name`, which the build-number capability takes.

function authHeaders(config: BrowserStackConfig): Record<string, string> {
  const auth = Buffer.from(getBrowserStackAuth(config)).toString("base64");
  return {
    Authorization: `Basic ${auth}`,
    "Content-Type": "application/json",
  };
}

async function getWithRetry(
  url: string,
  config: BrowserStackConfig,
  params?: Record<string, string | number>,
) {
  const request = () =>
    apiClient.get({
      url,
      headers: authHeaders(config),
      ...(params ? { params } : {}),
      raise_error: false,
    });
  try {
    return await request();
  } catch {
    return await request();
  }
}

function httpError(what: string, status: number, statusText: string): Error {
  return new HttpError(
    `Failed to ${what}: ${status} ${statusText}`.trim(),
    status,
  );
}

export async function fetchLatestBuildId(
  projectName: string,
  buildName: string,
  config: BrowserStackConfig,
  userName?: string,
): Promise<string | undefined> {
  const params: Record<string, string> = {
    project_name: projectName,
    build_name: buildName,
  };
  if (userName) params.user_name = userName;

  const response = await getWithRetry(
    `${getAutomationBaseUrl()}/ext/v1/builds/latest`,
    config,
    params,
  );
  if (response.status === 404) return undefined;
  if (!response.ok) {
    throw httpError(
      "look up the latest build",
      response.status,
      response.statusText,
    );
  }
  const buildId = response.data?.build_id;
  return typeof buildId === "string" && buildId ? buildId : undefined;
}
