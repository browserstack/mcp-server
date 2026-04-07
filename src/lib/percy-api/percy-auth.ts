/**
 * Percy authentication — uses BrowserStack Basic Auth for ALL Percy API calls.
 *
 * This is the correct auth method. The existing working tools (fetchPercyChanges,
 * managePercyBuildApproval) all use Basic Auth successfully.
 *
 * Percy Token (PERCY_TOKEN) is only needed for:
 * - percy CLI commands (percy exec, percy snapshot)
 * - Direct build creation when no BrowserStack credentials available
 */

import { getBrowserStackAuth } from "../get-auth.js";
import { BrowserStackConfig } from "../types.js";

/**
 * Get auth headers for Percy API calls.
 * Uses BrowserStack Basic Auth (username:accessKey).
 */
export function getPercyAuthHeaders(config: BrowserStackConfig): Record<string, string> {
  const authString = getBrowserStackAuth(config);
  const auth = Buffer.from(authString).toString("base64");

  return {
    Authorization: `Basic ${auth}`,
    "Content-Type": "application/json",
    "User-Agent": "browserstack-mcp-server",
  };
}

/**
 * Get Percy Token auth headers (for token-scoped operations).
 * Falls back to fetching token via BrowserStack API if not in env.
 */
export function getPercyTokenHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Token token=${token}`,
    "Content-Type": "application/json",
    "User-Agent": "browserstack-mcp-server",
  };
}

const PERCY_API_BASE = "https://percy.io/api/v1";

/**
 * Make a GET request to Percy API with Basic Auth.
 */
export async function percyGet(
  path: string,
  config: BrowserStackConfig,
  params?: Record<string, string>,
): Promise<any> {
  const headers = getPercyAuthHeaders(config);
  const url = new URL(`${PERCY_API_BASE}${path}`);

  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }

  const response = await fetch(url.toString(), { headers });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`GET ${path}: ${response.status} ${response.statusText}. ${body}`);
  }

  if (response.status === 204) return null;
  return response.json();
}

/**
 * Make a POST request to Percy API with Basic Auth.
 */
export async function percyPost(
  path: string,
  config: BrowserStackConfig,
  body?: unknown,
): Promise<any> {
  const headers = getPercyAuthHeaders(config);
  const url = `${PERCY_API_BASE}${path}`;

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const responseBody = await response.text().catch(() => "");
    throw new Error(`POST ${path}: ${response.status} ${response.statusText}. ${responseBody}`);
  }

  if (response.status === 204) return null;
  return response.json();
}

/**
 * Make a PATCH request to Percy API with Basic Auth.
 */
export async function percyPatch(
  path: string,
  config: BrowserStackConfig,
  body?: unknown,
): Promise<any> {
  const headers = getPercyAuthHeaders(config);
  const url = `${PERCY_API_BASE}${path}`;

  const response = await fetch(url, {
    method: "PATCH",
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const responseBody = await response.text().catch(() => "");
    throw new Error(`PATCH ${path}: ${response.status} ${response.statusText}. ${responseBody}`);
  }

  if (response.status === 204) return null;
  return response.json();
}

/**
 * Make a POST to Percy API using Percy Token auth.
 * Used for build creation when a project token is available.
 */
export async function percyTokenPost(
  path: string,
  token: string,
  body?: unknown,
): Promise<any> {
  const headers = getPercyTokenHeaders(token);
  const url = `${PERCY_API_BASE}${path}`;

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const responseBody = await response.text().catch(() => "");
    throw new Error(`POST ${path}: ${response.status} ${response.statusText}. ${responseBody}`);
  }

  if (response.status === 204) return null;
  return response.json();
}

/**
 * Get or create a Percy project token via BrowserStack API.
 * Creates the project if it doesn't exist.
 */
export async function getOrCreateProjectToken(
  projectName: string,
  config: BrowserStackConfig,
  type?: string,
): Promise<string> {
  const authString = getBrowserStackAuth(config);
  const auth = Buffer.from(authString).toString("base64");

  const params = new URLSearchParams({ name: projectName });
  if (type) params.append("type", type);

  const url = `https://api.browserstack.com/api/app_percy/get_project_token?${params.toString()}`;
  const response = await fetch(url, {
    headers: { Authorization: `Basic ${auth}` },
  });

  if (!response.ok) {
    throw new Error(`Failed to get token for project "${projectName}": ${response.status}`);
  }

  const data = await response.json();
  if (!data?.token || !data?.success) {
    throw new Error(`No token returned for project "${projectName}". Check the project name.`);
  }

  return data.token;
}
