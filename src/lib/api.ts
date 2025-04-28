import config from "../config";
import path from "path";
import fs from "fs";

const DOWNLOADS_DIR = path.join(process.cwd(), "browserstack-mcp-downloads");
const NETWORK_LOGS_DIR = path.join(DOWNLOADS_DIR, "network");

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

// Fetches network logs for a given session ID and returns log file location if successful
export async function downloadNetworkLogs(sessionId: string): Promise<string> {
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

  const networklogs = await response.json();
  const filePath = path.join(NETWORK_LOGS_DIR, `networklogs-${sessionId}.har`);

  // Create logs directory if it doesn't exist
  fs.mkdirSync(NETWORK_LOGS_DIR, { recursive: true });

  try {
    fs.writeFileSync(filePath, JSON.stringify(networklogs, null, 2));
    return filePath;
  } catch (writeError) {
    throw writeError instanceof Error
      ? writeError
      : new Error("Failed to write network logs file");
  }
}
