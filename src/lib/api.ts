import config from "../config";
import path from "path";
import fs from "fs";

const LOGS_DIR = path.join(process.cwd(), "logs", "network");

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
export async function downloadNetworkLogs(
  sessionId: string,
): Promise<{ success: boolean; filepath?: string; error?: string }> {
  if (!sessionId) {
    return { success: false, error: "You must provide a sessionId." };
  }
  const url = `https://api.browserstack.com/automate/sessions/${sessionId}/networklogs`;
  const auth = Buffer.from(
    `${config.browserstackUsername}:${config.browserstackAccessKey}`,
  ).toString("base64");

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${auth}`,
      },
    });

    if (response.status === 404) {
      return { success: false, error: "Session Id is not valid" };
    }

    if (!response.ok) {
      return {
        success: false,
        error: `HTTP error! status: ${response.status}`,
      };
    }

    const networklogs = await response.json();
    const filePath = path.join(LOGS_DIR, `networklogs-${sessionId}.har`);

    // Create logs directory if it doesn't exist
    fs.mkdirSync(LOGS_DIR, { recursive: true });

    try {
      fs.writeFileSync(filePath, JSON.stringify(networklogs, null, 2));
      return { success: true, filepath: filePath };
    } catch (writeError) {
      const errorMessage =
        writeError instanceof Error
          ? writeError.message
          : "Unknown error writing file";
      return { success: false, error: errorMessage };
    }
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error occurred";
    return { success: false, error: errorMessage };
  }
}
