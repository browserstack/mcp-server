import config from "../config";
import { HarEntry, HarFile } from "./utils";

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

// Fetches network logs for a given session ID and returns only failure logs
export async function retrieveNetworkFailures(sessionId: string): Promise<any> {
  if (!sessionId) {
    throw new Error("Session ID is required");
  }
  const url = `https://api.browserstack.com/automate/sessions/${sessionId}/networklogs`;
  const auth = Buffer.from(
    `${config.browserstackUsername}:${config.browserstackAccessKey}`,
  ).toString("base64");

  const response = await fetch(url, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${auth}`,
    },
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error("Invalid session ID");
    }
    throw new Error(`Failed to fetch network logs: ${response.statusText}`);
  }

  const networklogs: HarFile = await response.json();

  // Filter for failure logs
  const failureEntries: HarEntry[] = networklogs.log.entries.filter(
    (entry: HarEntry) => {
      return (
        entry.response.status === 0 ||
        entry.response.status >= 400 ||
        entry.response._error !== undefined
      );
    },
  );

  // Return only the failure entries with some context
  return {
    failures: failureEntries.map((entry: any) => ({
      startedDateTime: entry.startedDateTime,
      request: {
        method: entry.request?.method,
        url: entry.request?.url,
        queryString: entry.request?.queryString,
      },
      response: {
        status: entry.response?.status,
        statusText: entry.response?.statusText,
        _error: entry.response?._error,
      },
      serverIPAddress: entry.serverIPAddress,
      time: entry.time,
    })),
    totalFailures: failureEntries.length,
  };
}
